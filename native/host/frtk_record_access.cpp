#include "frtk_record_access.h"

#include <algorithm>
#include <iomanip>
#include <limits>
#include <set>
#include <sstream>

namespace cfb27::frtk {
namespace {

constexpr const char* kStale = "CATALOG_STALE";
constexpr const char* kInvalid = "FIELD_INVALID";

std::string Address(std::uintptr_t address) {
  std::ostringstream stream;
  stream << "0x" << std::uppercase << std::hex << address;
  return stream.str();
}

const TableSchema* SchemaFor(const SchemaRegistry& schema,
                             const CatalogDescriptor& descriptor) {
  const auto* table = schema.FindTable(descriptor.session_table_id);
  if (!table || table->unique_id != descriptor.unique_id ||
      table->capacity != descriptor.capacity ||
      table->record_size != descriptor.stride) {
    return nullptr;
  }
  return table;
}

bool RowAddress(const CatalogDescriptor& descriptor, std::uint32_t row,
                std::uintptr_t& address) {
  if (row >= descriptor.capacity ||
      (row != 0 && descriptor.stride >
                       std::numeric_limits<std::size_t>::max() / row)) {
    return false;
  }
  const auto offset = static_cast<std::size_t>(row) * descriptor.stride;
  if (offset > std::numeric_limits<std::uintptr_t>::max() -
                   descriptor.base_address) {
    return false;
  }
  address = descriptor.base_address + offset;
  return true;
}

bool ValidReference(const SchemaRegistry& schema, const FieldDefinition& field,
                    const DecodedField& value) {
  if (field.encoding != "packed-reference") return true;
  const auto* reference = std::get_if<PackedReference>(&value);
  if (!reference || !field.reference_table_id ||
      reference->table_id != *field.reference_table_id) {
    return false;
  }
  const auto* target = schema.FindTable(reference->table_id);
  return target && reference->row_index < target->capacity;
}

}  // namespace

FieldReadResult RecordAccessor::ReadFields(
    TableHandle handle, std::uint32_t row,
    std::span<const std::string_view> fields) {
  if (!catalog_.Revalidate(validation_backend_)) return {.code = kStale};
  const auto* descriptor = catalog_.Resolve(handle);
  if (!descriptor) return {.code = kStale};
  const auto* table = SchemaFor(schema_, *descriptor);
  std::uintptr_t address{};
  if (!table || !RowAddress(*descriptor, row, address) || fields.empty()) {
    return {.code = kInvalid};
  }
  std::vector<const FieldDefinition*> definitions;
  definitions.reserve(fields.size());
  for (const auto name : fields) {
    const auto* field = schema_.FindField(table->table_id, name);
    if (!field) return {.code = kInvalid};
    definitions.push_back(field);
  }
  std::vector<std::uint8_t> record(table->record_size);
  if (!memory_backend_.Validate(address, record.size(), false) ||
      !memory_backend_.Read(address, record)) {
    return {.code = "READ_FAILED"};
  }
  FieldReadResult result{.ok = true};
  try {
    for (std::size_t index = 0; index < definitions.size(); ++index) {
      auto value = DecodeField(record, *definitions[index]);
      if (!ValidReference(schema_, *definitions[index], value)) {
        return {.code = kInvalid};
      }
      result.fields.push_back({std::string(fields[index]), std::move(value)});
    }
  } catch (...) {
    return {.code = kInvalid};
  }
  return result;
}

FieldWritePlan RecordAccessor::PlanFieldWrites(
    TableHandle handle, std::uint32_t row,
    std::span<const FieldChange> changes) {
  if (!catalog_.Revalidate(validation_backend_)) return {.code = kStale};
  const auto* descriptor = catalog_.Resolve(handle);
  if (!descriptor) return {.code = kStale};
  const auto* table = SchemaFor(schema_, *descriptor);
  if (!table) return {.code = kInvalid};
  if (table->authority_status != AuthorityStatus::kDirectVerified) {
    return {.code = "AUTHORITY_UNPROVEN"};
  }
  std::uintptr_t address{};
  if (!RowAddress(*descriptor, row, address) || changes.empty()) {
    return {.code = kInvalid};
  }
  std::set<std::string_view> names;
  std::vector<const FieldDefinition*> definitions;
  definitions.reserve(changes.size());
  for (const auto& change : changes) {
    if (!names.insert(change.name).second) return {.code = kInvalid};
    const auto* field = schema_.FindField(table->table_id, change.name);
    if (!field || !ValidReference(schema_, *field, change.value)) {
      return {.code = kInvalid};
    }
    definitions.push_back(field);
  }
  std::vector<std::uint8_t> original(table->record_size);
  if (!memory_backend_.Validate(address, original.size(), false) ||
      !memory_backend_.Read(address, original)) {
    return {.code = "READ_FAILED"};
  }
  auto replacement = original;
  try {
    for (std::size_t index = 0; index < changes.size(); ++index) {
      replacement = EncodeField(replacement, *definitions[index],
                                changes[index].value);
    }
  } catch (...) {
    return {.code = kInvalid};
  }

  FieldWritePlan result{.ok = true};
  std::size_t index = 0;
  while (index < original.size()) {
    while (index < original.size() && original[index] == replacement[index]) {
      ++index;
    }
    if (index == original.size()) break;
    const auto begin = index;
    while (index < original.size() && original[index] != replacement[index]) {
      ++index;
    }
    result.operations.push_back(
        {.address = Address(address + begin),
         .expected = {original.begin() + begin, original.begin() + index},
         .replacement = {replacement.begin() + begin,
                         replacement.begin() + index}});
    if (result.operations.size() > memory::kMaxTransactionOperations) {
      return {.code = kInvalid};
    }
  }
  if (result.operations.empty()) return {.code = kInvalid};
  return result;
}

}  // namespace cfb27::frtk
