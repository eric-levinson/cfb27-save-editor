#include "../host/frtk_catalog.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <iostream>
#include <map>
#include <stdexcept>
#include <vector>

namespace {
using namespace cfb27::frtk;

void Require(bool value, const char* message) {
  if (!value) throw std::runtime_error(message);
}

ProfileBundle Bundle() {
  ProfileBundle result;
  result.profile_id = "synthetic-profile";
  result.tables = {
      {.logical_name = "Target", .table_id = 22, .unique_id = 220022,
       .capacity = 4, .record_size = 8,
       .rows = {{.row_index = 0, .pattern = {1, 2}, .mask = {255, 255}},
                {.row_index = 1, .pattern = {3, 4}, .mask = {255, 255}},
                {.row_index = 2, .pattern = {5, 6}, .mask = {255, 255}}}},
      {.logical_name = "Source", .table_id = 33, .unique_id = 330033,
       .capacity = 4, .record_size = 8,
       .rows = {{.row_index = 0, .pattern = {7, 8}, .mask = {255, 255}},
                {.row_index = 1, .pattern = {9, 10}, .mask = {255, 255}},
                {.row_index = 2, .pattern = {11, 12}, .mask = {255, 255}}},
       .relationships = {{.source_row = 1, .field_name = "TargetRef",
                          .target_table_id = 22, .target_row = 2}}},
  };
  std::string error;
  const nlohmann::json schema = {
      {"formatVersion", 1}, {"schemaIdentity", "synthetic-schema"},
      {"buildIdentity", "synthetic-build"},
      {"tables", nlohmann::json::array({
          {{"logicalName", "Target"}, {"tableId", 22}, {"uniqueId", 220022},
           {"capacity", 4}, {"recordSize", 8},
           {"authorityStatus", "discovery_only"},
           {"fields", nlohmann::json::array()}},
          {{"logicalName", "Source"}, {"tableId", 33}, {"uniqueId", 330033},
           {"capacity", 4}, {"recordSize", 8},
           {"authorityStatus", "discovery_only"},
           {"fields", nlohmann::json::array({
               {{"name", "TargetRef"}, {"encoding", "packed-reference"},
                {"byteOffset", 4}, {"storageBytes", 4}, {"bitOffset", 0},
                {"bitWidth", 32}, {"minimum", 0}, {"maximum", 0xFFFFFFFFull},
                {"referenceTableId", 22}}
           })}}
      })}};
  Require(result.schema.Load(schema, &error), error.c_str());
  return result;
}

DiscoveryResult Discovery() {
  return {.tables = {
      {.unique_id = 220022, .state = TableState::kResolved,
       .descriptor = TableDescriptor{.unique_id = 220022, .base = 0x1000,
          .stride = 8, .capacity = 4, .allocation_base = 0x1000,
          .allocation_size = 32}, .evidence = {{"TARGET_OK", 3}}},
      {.unique_id = 330033, .state = TableState::kResolved,
       .descriptor = TableDescriptor{.unique_id = 330033, .base = 0x2000,
          .stride = 8, .capacity = 4, .allocation_base = 0x2000,
          .allocation_size = 32}, .evidence = {{"SOURCE_OK", 3}}}
  }};
}

class Backend final : public DiscoveryBackend {
 public:
  std::map<std::uintptr_t, std::vector<std::uint8_t>> reads;
  bool allocation_ok{true};
  std::size_t batch_calls{};
  ScanObservationResult Scan(const RowFingerprint&, std::size_t) override {
    return {};
  }
  bool ReadBatch(std::span<const ReadRequest> requests,
                 std::vector<std::vector<std::uint8_t>>& out) override {
    ++batch_calls;
    out.clear();
    for (const auto& request : requests) {
      auto found = reads.find(request.address);
      if (found == reads.end() || found->second.size() != request.length) return false;
      out.push_back(found->second);
    }
    return true;
  }
  bool AllocationExists(std::uintptr_t, std::size_t) override {
    return allocation_ok;
  }
};

Backend ValidBackend() {
  Backend backend;
  backend.reads = {{0x1000, {1, 2}}, {0x1008, {3, 4}}, {0x1010, {5, 6}},
                   {0x2000, {7, 8}}, {0x2008, {9, 10}}, {0x2010, {11, 12}},
                   {0x200C, {2, 0, 44, 0}}};
  return backend;
}

void TestGenerationAndPublicSurface() {
  SessionCatalog catalog;
  const auto profile = Bundle();
  const auto discovery = Discovery();
  const auto first_generation = catalog.Install(profile, discovery);
  const auto handle = catalog.GetHandle(330033);
  Require(handle && handle->generation == first_generation, "unique-ID lookup failed");
  Require(!catalog.GetHandle(33), "session table ID leaked into public lookup");
  Require(catalog.Resolve(*handle) != nullptr, "current handle did not resolve");
  const auto summaries = catalog.Summaries();
  Require(summaries.size() == 2 && summaries[1].unique_id == 330033,
          "sanitized summaries missing catalog entries");

  const auto second_generation = catalog.Install(profile, discovery);
  Require(second_generation > first_generation && catalog.Resolve(*handle) == nullptr,
          "install did not stale old handles");
  const auto fresh = *catalog.GetHandle(330033);
  catalog.Invalidate();
  Require(catalog.Resolve(fresh) == nullptr, "explicit invalidation retained handles");
}

void TestLifecycleAndRevalidation() {
  const auto profile = Bundle();
  const auto discovery = Discovery();
  SessionCatalog catalog;
  catalog.Install(profile, discovery);
  const auto generation = catalog.generation();
  catalog.AdvanceLifecycle(false);
  const auto invalidated = catalog.generation();
  Require(invalidated > generation, "game_ready:false did not invalidate");
  catalog.AdvanceLifecycle(false);
  Require(catalog.generation() == invalidated,
          "repeated game_ready:false was not idempotent");

  catalog.Install(profile, discovery);
  auto backend = ValidBackend();
  Require(catalog.Revalidate(backend) && backend.batch_calls == 1,
          "sentinels and relationships were not batch revalidated");

  auto target = *catalog.GetHandle(220022);
  backend.allocation_ok = false;
  Require(!catalog.Revalidate(backend) && catalog.Resolve(target) == nullptr,
          "allocation loss did not quarantine and stale handles");

  catalog.Install(profile, discovery);
  backend = ValidBackend();
  backend.reads[0x1008] = {0, 0};
  Require(!catalog.Revalidate(backend) && !catalog.GetHandle(220022),
          "sentinel mismatch did not quarantine table");

  catalog.Install(profile, discovery);
  backend = ValidBackend();
  backend.reads[0x200C] = {3, 0, 44, 0};
  Require(!catalog.Revalidate(backend) && !catalog.GetHandle(330033) &&
              catalog.GetHandle(220022).has_value(),
          "relationship failure did not quarantine dependent descriptor");
}
}  // namespace

int main() {
  try {
    TestGenerationAndPublicSurface();
    TestLifecycleAndRevalidation();
    std::cout << "frtk catalog smoke passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "frtk catalog smoke failed: " << error.what() << '\n';
    return 1;
  }
}
