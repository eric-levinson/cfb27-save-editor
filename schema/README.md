This directory is generated from the local game install when schema discovery runs.

Source currently used:
`F:\EA SPORTS College Football 27\Data\Win32\superbundlelayout\football_installpackage_00\cas_62.cas`

The CAS file contains a plaintext FranTk schema XML payload for `CollegeFB27_Gen5.CFB27_RL`.
Generated files are ignored by the app unless present.

Generated files:
- `CollegeFB27_Gen5_CFB27_RL_schemas.xml`: extracted FranTk XML.
- `recruiting_schema_index.json`: compact schema/enum index filtered for recruiting, prospect, scholarship, pipeline, visit, scouting, NIL, portal, influence, and pitch terms.

The web app uses the JSON index read-only. Dynasty recruiting values are not writable yet because the autosave payload is an `FrTk` database-style structure, not the roster TLV layout. Current mapping work surfaces schema definitions and exact save offsets for matching objects such as `Recruit`, `RecruitTarget`, `RecruitingBoard`, `ProspectTargetSchool`, `UserRecruitTarget`, and transfer portal stores.
