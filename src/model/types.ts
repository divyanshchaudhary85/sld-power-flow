// Generated from the approved Phase 0 contract. JSON Schema is authoritative.

export type ID = string;

export type Timestamp = string;

export type Revision = number;

export type Point = { "x": number; "y": number };

export type Box = { "x_min": number; "y_min": number; "x_max": number; "y_max": number };

export type DrawingRef = { "file_id": ID; "page": number; "bbox": Box; "text_span_ids": Array<ID> };

export type SourceRef = ({ "kind": "drawing"; "primary": DrawingRef; "evidence": Array<DrawingRef> } | { "kind": "synthetic"; "fixture_id": ID; "generated_drawing": (DrawingRef | null) } | { "kind": "user_added"; "created_at": Timestamp; "manually_marked_region": (DrawingRef | null) });

export type Provenance = ({ "source": "drawing"; "confidence": number; "evidence": Array<DrawingRef>; "extraction_run_id": ID; "reviewed": boolean } | { "source": "user"; "changed_at": Timestamp; "supersedes_path": (string | null); "evidence": Array<DrawingRef> } | { "source": "library"; "library_id": ID; "library_version": string; "item_id": ID; "accepted_at": Timestamp } | { "source": "default"; "default_id": ID; "default_version": string; "accepted_at": Timestamp; "rationale": string });

export type Derivation = { "rule_id": ID; "rule_version": string; "input_paths": Array<string>; "description": string };

export type FieldNumber = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<number>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": number; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldInteger = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<number>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": number; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldString = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<string>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": string; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldBoolean = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<boolean>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": boolean; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldID = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<ID>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": ID; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldNullableNumber = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<(number | null)>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": (number | null); "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldNullableString = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<(string | null)>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": (string | null); "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldNullableID = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<(ID | null)>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": (ID | null); "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldFrequency = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<50 | 60>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": 50 | 60; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldNetworkType = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"transmission_subtransmission" | "industrial" | "distribution">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "transmission_subtransmission" | "industrial" | "distribution"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldSymbols = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"IEC" | "ANSI_IEEE">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "IEC" | "ANSI_IEEE"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldOrigin = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"uploaded" | "sample" | "manual">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "uploaded" | "sample" | "manual"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldSwitchState = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"open" | "closed">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "open" | "closed"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldReactiveKind = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"leading" | "lagging">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "leading" | "lagging"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldGeneratorMode = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"pv" | "slack">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "pv" | "slack"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldGridMode = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"slack" | "voltage_controlled">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "slack" | "voltage_controlled"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldStaticTechnology = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"pv" | "storage" | "other">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "pv" | "storage" | "other"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldShuntTechnology = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"capacitor" | "reactor" | "other">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "capacitor" | "reactor" | "other"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldTapSide = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"hv" | "lv">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "hv" | "lv"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldTapChanger = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"ratio" | "phase_shift">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "ratio" | "phase_shift"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldElementTag = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"busbar" | "line" | "cable" | "transformer_2w" | "external_grid" | "generator" | "static_generator" | "load" | "motor" | "shunt" | "circuit_breaker" | "disconnector" | "fuse" | "unknown">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "busbar" | "line" | "cable" | "transformer_2w" | "external_grid" | "generator" | "static_generator" | "load" | "motor" | "shunt" | "circuit_breaker" | "disconnector" | "fuse" | "unknown"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldTapCapability = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<({ "kind": "none" } | { "kind": "fixed"; "side": FieldTapSide; "neutral": FieldInteger; "min": FieldInteger; "max": FieldInteger; "position": FieldInteger; "step_percent": FieldNumber; "step_degree": FieldNumber; "changer_type": FieldTapChanger; "ratio_definition": FieldString })>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": ({ "kind": "none" } | { "kind": "fixed"; "side": FieldTapSide; "neutral": FieldInteger; "min": FieldInteger; "max": FieldInteger; "position": FieldInteger; "step_percent": FieldNumber; "step_degree": FieldNumber; "changer_type": FieldTapChanger; "ratio_definition": FieldString }); "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldTypeReference = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<({ "library_id": ID; "version": string; "item_id": ID } | null)>; "evidence": Array<DrawingRef> } | { "status": "known"; "value": ({ "library_id": ID; "version": string; "item_id": ID } | null); "provenance": Provenance; "derivation": (Derivation | null) });

export type CaseMeta = { "name": FieldString; "network_type": FieldNetworkType; "frequency_hz": FieldFrequency; "symbol_set": FieldSymbols; "base_mva": FieldNumber; "case_origin": FieldOrigin; "description": FieldNullableString; "created_at": Timestamp; "modified_at": Timestamp; "fixture_id": (ID | null); "source_case_hash": (string | null) };

export type StudySettings = { "slack_element_id": FieldID; "slack_confirmed": FieldBoolean; "base_confirmed": FieldBoolean; "voltage_min_pu": FieldNumber; "voltage_max_pu": FieldNumber; "branch_warning_percent": FieldNumber; "branch_alarm_percent": FieldNumber; "transformer_z_min_percent": FieldNumber; "transformer_z_max_percent": FieldNumber; "nominal_voltage_tolerance_percent": FieldNumber; "low_confidence_threshold": FieldNumber; "voltage_unit_slip_ratio": FieldNumber; "power_unit_slip_ratio": FieldNumber; "slack_import_limit_mw": FieldNullableNumber; "allow_slack_export": FieldBoolean; "solver_tolerance_mva": FieldNumber; "max_iterations": FieldInteger; "enforce_q_limits": FieldBoolean; "conventions": Conventions; "additional_rule_thresholds": Array<RuleThreshold> };

export type RuleThreshold = { "rule_id": ID; "parameter_name": string; "value": FieldNumber; "unit": string };

export type Conventions = { "positive_sequence": true; "balanced": true; "algorithm": "newton_raphson"; "voltage_angles": "degrees"; "branch_power_sign": "positive_from_bus_into_element"; "generator_power_sign": "positive_injection"; "load_power_sign": "positive_consumption"; "shunt_power_sign": "positive_consumption_inductive_q"; "bus_net_power_sign": "positive_injection"; "transformer_equivalent": "t"; "tap_control": "fixed_user_position"; "distributed_slack": false };

export type SourceFile = { "file_id": ID; "name": string; "media_type": "application/pdf" | "image/png" | "image/jpeg" | "image/tiff"; "sha256": string; "byte_size": number; "browser_blob_key": (string | null); "pages": Array<SourcePage> };

export type SourcePage = { "page": number; "original_width": number; "original_height": number; "original_unit": "pt" | "px"; "raster_width": number; "raster_height": number; "raster_dpi": number; "rotation_degree": number; "deskew_transform": Array<number>; "title_block": (Box | null); "legend": (Box | null); "text_spans": Array<TextSpan>; "tiles": Array<Tile> };

export type TextSpan = { "id": ID; "text": string; "bbox": Box; "source": "pdf_text" | "vision" };

export type Tile = { "id": ID; "bbox": Box; "raster_width": number; "raster_height": number; "overlap_fraction": number; "scale": number; "status": "queued" | "running" | "valid" | "failed"; "extraction_run_id": (ID | null) };

export type ExtractionRun = { "id": ID; "provider": string; "model": string; "request_schema_version": string; "prompt_version": string; "started_at": Timestamp; "ended_at": (Timestamp | null); "tile_count": number; "success_count": number; "retry_count": number; "failures": Array<string>; "input_tokens": (number | null); "output_tokens": (number | null); "reported_cost": (number | null); "reported_cost_currency": (string | null) };

export type ObservedAttribute = { "name": string; "value": (FieldNumber | FieldString | FieldBoolean) };

export type Observation = { "id": ID; "tile_id": ID; "detected_type": FieldElementTag; "label": FieldString; "attributes": Array<ObservedAttribute>; "source_ref": DrawingRef; "confidence": number; "terminals": Array<EndpointObservation>; "line_paths": Array<Array<Point>> };

export type EndpointObservation = { "id": ID; "observation_id": ID; "position": Point; "source_ref": DrawingRef; "attached_observation_id": FieldNullableID };

export type TextObservation = { "id": ID; "text": FieldString; "source_ref": DrawingRef; "associated_element_id": FieldNullableID };

export type MergeDecision = { "observation_ids": Array<ID>; "outcome": "merged" | "kept_distinct" | "unresolved" | "human_corrected"; "rule_id": ID; "element_ids": Array<ID>; "description": string };

export type ExtractionWorkspace = { "runs": Array<ExtractionRun>; "observations": Array<Observation>; "unassociated_text": Array<TextObservation>; "unresolved_endpoints": Array<EndpointObservation>; "merge_decisions": Array<MergeDecision>; "annotations": Array<Annotation> };

export type ConnectivityPoint = { "id": ID; "position": Point; "source_ref": SourceRef; "kind": "junction" | "terminal_point"; "evidence": Array<DrawingRef> };

export type Layout = { "position": Point; "rotation_degree": number; "width": (number | null); "height": (number | null); "route_points": Array<Point>; "page_group": (string | null); "bay_group": (string | null); "updated_at": Timestamp };

export type ElementReview = { "status": "unreviewed" | "confirmed" | "edited"; "reviewed_revision": (Revision | null); "reviewed_at": (Timestamp | null) };

export type Annotation = { "id": ID; "text": string; "source_ref": SourceRef; "layout": Layout; "disposition": "annotation" | "legend" | "title_block"; "review": ElementReview };

export type FieldBusbarTag = { "status": "known"; "value": "busbar"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Busbar = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldBusbarTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "nominal_kv": FieldNumber; "voltage_min_pu": FieldNullableNumber; "voltage_max_pu": FieldNullableNumber } };

export type FieldLineTag = { "status": "known"; "value": "line"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Line = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldLineTag; "terminals": { "from": { "id": ID; "role": "from"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "to": { "id": ID; "role": "to"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "length_km": FieldNumber; "r_ohm_per_km": FieldNumber; "x_ohm_per_km": FieldNumber; "b_us_per_km": FieldNumber; "g_us_per_km": FieldNumber; "max_current_ka": FieldNumber; "derating_factor": FieldNumber; "parallel_count": FieldInteger; "standard_type": FieldTypeReference; "from_nominal_kv": FieldNullableNumber; "to_nominal_kv": FieldNullableNumber } };

export type FieldCableTag = { "status": "known"; "value": "cable"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Cable = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldCableTag; "terminals": { "from": { "id": ID; "role": "from"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "to": { "id": ID; "role": "to"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "length_km": FieldNumber; "r_ohm_per_km": FieldNumber; "x_ohm_per_km": FieldNumber; "b_us_per_km": FieldNumber; "g_us_per_km": FieldNumber; "max_current_ka": FieldNumber; "derating_factor": FieldNumber; "parallel_count": FieldInteger; "standard_type": FieldTypeReference; "from_nominal_kv": FieldNullableNumber; "to_nominal_kv": FieldNullableNumber } };

export type FieldTransformer2WTag = { "status": "known"; "value": "transformer_2w"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Transformer2W = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldTransformer2WTag; "terminals": { "hv": { "id": ID; "role": "hv"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "lv": { "id": ID; "role": "lv"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "sn_mva": FieldNumber; "vn_hv_kv": FieldNumber; "vn_lv_kv": FieldNumber; "vk_percent": FieldNumber; "vkr_percent": FieldNumber; "pfe_kw": FieldNumber; "i0_percent": FieldNumber; "phase_shift_degree": FieldNumber; "derating_factor": FieldNumber; "parallel_count": FieldInteger; "standard_type": FieldTypeReference; "tap": FieldTapCapability } };

export type FieldExternalGridTag = { "status": "known"; "value": "external_grid"; "provenance": Provenance; "derivation": (Derivation | null) };

export type ExternalGrid = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldExternalGridTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "voltage_setpoint_kv": FieldNumber; "angle_degree": FieldNumber; "infeed_rating_mva": FieldNumber; "p_dispatch_mw": FieldNullableNumber; "min_p_mw": FieldNullableNumber; "max_p_mw": FieldNullableNumber; "min_q_mvar": FieldNullableNumber; "max_q_mvar": FieldNullableNumber; "mode": FieldGridMode } };

export type FieldGeneratorTag = { "status": "known"; "value": "generator"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Generator = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldGeneratorTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "p_mw": FieldNumber; "voltage_setpoint_kv": FieldNumber; "sn_mva": FieldNumber; "min_p_mw": FieldNumber; "max_p_mw": FieldNumber; "min_q_mvar": FieldNullableNumber; "max_q_mvar": FieldNullableNumber; "mode": FieldGeneratorMode; "slack_angle_degree": FieldNullableNumber } };

export type FieldStaticGeneratorTag = { "status": "known"; "value": "static_generator"; "provenance": Provenance; "derivation": (Derivation | null) };

export type StaticGenerator = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldStaticGeneratorTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "p_mw": FieldNumber; "q_mvar": FieldNumber; "sn_mva": FieldNumber; "min_p_mw": FieldNumber; "max_p_mw": FieldNumber; "min_q_mvar": FieldNumber; "max_q_mvar": FieldNumber; "technology": FieldStaticTechnology } };

export type FieldLoadModel = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"constant_pq">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "constant_pq"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldLoadTag = { "status": "known"; "value": "load"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Load = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldLoadTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "p_mw": FieldNumber; "q_mvar": FieldNumber; "scaling_factor": FieldNumber; "sn_mva": FieldNullableNumber; "power_factor": FieldNullableNumber; "reactive_kind": FieldReactiveKind; "model": FieldLoadModel } };

export type FieldMotorTag = { "status": "known"; "value": "motor"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Motor = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldMotorTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "p_mw": FieldNumber; "q_mvar": FieldNumber; "scaling_factor": FieldNumber; "sn_mva": FieldNullableNumber; "power_factor": FieldNullableNumber; "reactive_kind": FieldReactiveKind; "model": FieldLoadModel } };

export type FieldShuntModel = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"constant_impedance">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "constant_impedance"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldShuntTag = { "status": "known"; "value": "shunt"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Shunt = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldShuntTag; "terminals": { "bus": { "id": ID; "role": "bus"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "p_mw": FieldNumber; "q_mvar": FieldNumber; "nominal_kv": FieldNumber; "step": FieldInteger; "max_step": FieldInteger; "technology": FieldShuntTechnology; "model": FieldShuntModel } };

export type FieldSwitchModel = ({ "status": "missing"; "reason": "not_shown" | "unreadable" | "ambiguous" | "not_entered"; "candidates": Array<"ideal">; "evidence": Array<DrawingRef> } | { "status": "known"; "value": "ideal"; "provenance": Provenance; "derivation": (Derivation | null) });

export type FieldCircuitBreakerTag = { "status": "known"; "value": "circuit_breaker"; "provenance": Provenance; "derivation": (Derivation | null) };

export type CircuitBreaker = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldCircuitBreakerTag; "terminals": { "a": { "id": ID; "role": "a"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "b": { "id": ID; "role": "b"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "state": FieldSwitchState; "normal_state": FieldSwitchState; "rated_current_ka": FieldNumber; "rated_voltage_kv": FieldNullableNumber; "electrical_model": FieldSwitchModel } };

export type FieldDisconnectorTag = { "status": "known"; "value": "disconnector"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Disconnector = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldDisconnectorTag; "terminals": { "a": { "id": ID; "role": "a"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "b": { "id": ID; "role": "b"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "state": FieldSwitchState; "normal_state": FieldSwitchState; "rated_current_ka": FieldNumber; "rated_voltage_kv": FieldNullableNumber; "electrical_model": FieldSwitchModel } };

export type FieldFuseTag = { "status": "known"; "value": "fuse"; "provenance": Provenance; "derivation": (Derivation | null) };

export type Fuse = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldFuseTag; "terminals": { "a": { "id": ID; "role": "a"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) }; "b": { "id": ID; "role": "b"; "connection_point": FieldID; "source_ref": SourceRef; "drawn_anchor": (Point | null) } }; "data": { "state": FieldSwitchState; "normal_state": FieldSwitchState; "rated_current_ka": FieldNumber; "rated_voltage_kv": FieldNullableNumber; "electrical_model": FieldSwitchModel } };

export type FieldUnknownElementTag = { "status": "known"; "value": "unknown"; "provenance": Provenance; "derivation": (Derivation | null) };

export type UnknownElement = { "id": ID; "label": FieldString; "in_service": FieldBoolean; "source_ref": SourceRef; "layout": Layout; "review": ElementReview; "station": FieldNullableString; "bay": FieldNullableString; "notes": FieldNullableString; "type": FieldUnknownElementTag; "terminals": Record<string, never>; "data": { "raw_symbol_description": FieldString; "raw_label": FieldString; "possible_type": FieldElementTag } };

export type Element = (Busbar | Line | Cable | Transformer2W | ExternalGrid | Generator | StaticGenerator | Load | Motor | Shunt | CircuitBreaker | Disconnector | Fuse | UnknownElement);

export type ReviewDecision = { "id": ID; "element_ids": Array<ID>; "input_paths": Array<string>; "action": string; "at": Timestamp; "revision": Revision };

export type ReviewState = { "status": "pending" | "confirmed"; "confirmed_model_revision": (Revision | null); "confirmed_input_hash": (string | null); "confirmed_at": (Timestamp | null); "unresolved_element_ids": Array<ID>; "decisions": Array<ReviewDecision> };

export type JsonValue = (string | number | boolean | null | Array<JsonValue> | { [key: string]: JsonValue });

export type DataSuggestion = { "id": ID; "target_path": string; "candidate_value": JsonValue; "source": "library" | "default"; "source_id": ID; "source_version": string; "rationale": string; "status": "offered" | "accepted" | "rejected" };

export type MeasuredValue = { "value": number; "unit": string };

export type Finding = { "id": ID; "rule_id": ID; "rule_version": string; "stage": "drawing" | "topology" | "electrical" | "completeness" | "post_solve" | "solver_diagnostic"; "severity": "info" | "warning" | "error" | "alarm"; "blocks_solve": boolean; "message": string; "element_ids": Array<ID>; "field_paths": Array<string>; "locations": Array<DrawingRef>; "suggested_fix": string; "observed_value": (MeasuredValue | null); "limit": (MeasuredValue | null); "model_revision": Revision; "solution_run_id": (ID | null); "status": "active" | "resolved"; "cause_finding_ids": Array<ID> };

export type ValidationRun = { "id": ID; "model_revision": Revision; "input_hash": string; "ruleset_version": string; "started_at": Timestamp; "ended_at": Timestamp; "findings": Array<Finding>; "passed_pre_solve": boolean; "solver_diagnostics_version": (string | null) };

export type BaseSnapshot = { "revision": Revision; "input_hash": string; "meta": CaseMeta; "settings": StudySettings; "connectivity_points": Array<ConnectivityPoint>; "elements": Array<Element> };

export type Change = { "path": string; "before": JsonValue; "after": JsonValue };

export type Event = { "id": ID; "time": Timestamp; "kind": "switch" | "setpoint" | "tap" | "service" | "reset" | "compare" | "solve" | "review" | "edit"; "selected_element_ids": Array<ID>; "changes": Array<Change>; "previous_revision": Revision; "new_revision": Revision; "solver_run_id": (ID | null); "outcome": "requested" | "confirmed" | "cancelled" | "succeeded" | "failed"; "message": string };

export type AlarmAcknowledgement = { "finding_id": ID; "finding_fingerprint": string; "acknowledged_at": Timestamp; "acknowledged_revision": Revision };

export type TablePreference = { "table": "buses" | "lines" | "transformers" | "generators" | "loads" | "alarms" | "events"; "sort_key": string; "sort_direction": "asc" | "desc"; "filter": string; "visible_columns": Array<string> };

export type DisplayPreferences = { "theme": "dark" | "light"; "breaker_colour_convention": "shape_only" | "closed_red" | "closed_green"; "voltage_colouring": boolean; "tables": Array<TablePreference>; "viewport": { "x": number; "y": number; "zoom": number }; "display_revision": Revision };

export type IslandPolicy = { "mode": "preparation_strict" | "intentional_outage"; "authorized_isolated_element_ids": Array<ID>; "authorizing_event_ids": Array<ID>; "energized_island_slacks": Array<{ "connectivity_point_ids": Array<ID>; "slack_element_id": ID }> };

export type OperationState = { "base_snapshot": (BaseSnapshot | null); "events": Array<Event>; "acknowledgements": Array<AlarmAcknowledgement>; "display_preferences": DisplayPreferences; "island_policy": IslandPolicy };

export type ResultNumber = ({ "status": "available"; "value": number } | { "status": "unavailable"; "reason": "deenergized" | "nonconverged" | "not_applicable" | "failed" | "not_reported" });

export type BusResult = { "busbar_ids": Array<ID>; "solver_bus_id": ID; "energized": boolean; "voltage_pu": ResultNumber; "voltage_kv": ResultNumber; "angle_degree": ResultNumber; "net_p_mw": ResultNumber; "net_q_mvar": ResultNumber };

export type LineResult = { "element_id": ID; "energized": boolean; "p_from_mw": ResultNumber; "q_from_mvar": ResultNumber; "p_to_mw": ResultNumber; "q_to_mvar": ResultNumber; "i_from_ka": ResultNumber; "i_to_ka": ResultNumber; "loading_percent": ResultNumber; "p_loss_mw": ResultNumber; "q_loss_mvar": ResultNumber };

export type TransformerResult = { "element_id": ID; "energized": boolean; "p_hv_mw": ResultNumber; "q_hv_mvar": ResultNumber; "p_lv_mw": ResultNumber; "q_lv_mvar": ResultNumber; "i_hv_ka": ResultNumber; "i_lv_ka": ResultNumber; "loading_percent": ResultNumber; "p_loss_mw": ResultNumber; "q_loss_mvar": ResultNumber; "tap_position": ResultNumber };

export type GeneratorResult = { "element_id": ID; "energized": boolean; "at_q_min": (boolean | null); "at_q_max": (boolean | null); "p_mw": ResultNumber; "q_mvar": ResultNumber; "voltage_kv": ResultNumber };

export type DemandResult = { "element_id": ID; "energized": boolean; "p_mw": ResultNumber; "q_mvar": ResultNumber };

export type SystemResult = { "converged": boolean; "iterations": (number | null); "energized_bus_count": number; "total_generation_mw": ResultNumber; "total_generation_mvar": ResultNumber; "total_served_load_mw": ResultNumber; "total_served_load_mvar": ResultNumber; "total_unserved_load_mw": ResultNumber; "total_unserved_load_mvar": ResultNumber; "total_loss_mw": ResultNumber; "total_loss_mvar": ResultNumber; "slack_p_mw": ResultNumber; "slack_q_mvar": ResultNumber };

export type SolutionResults = { "buses": Array<BusResult>; "lines": Array<LineResult>; "transformers": Array<TransformerResult>; "generators": Array<GeneratorResult>; "external_grids": Array<GeneratorResult>; "loads": Array<DemandResult>; "shunts": Array<DemandResult>; "system": SystemResult };

export type SolverInfo = { "backend": "pandapower" | "typescript_newton_raphson" | "numpy_scipy_newton_raphson"; "backend_version": string; "runtime": string; "runtime_version": string; "package_lock_digest": string; "algorithm": "newton_raphson"; "tolerance_mva": number; "max_iterations": number; "enforce_q_limits": boolean; "transformer_equivalent": "t" };

export type SolverMapping = { "solver_id": ID; "solver_kind": "bus" | "branch" | "generator" | "load" | "shunt"; "canonical_element_ids": Array<ID>; "canonical_point_ids": Array<ID>; "terminal_ids": Array<ID> };

export type ResultDependency = { "result_path": string; "input_paths": Array<string>; "method": "direct" | "conservative_connected_component" };

export type ResultQuality = { "defaulted_input_paths": Array<string>; "library_input_paths": Array<string>; "user_input_paths": Array<string>; "dependencies": Array<ResultDependency> };

export type SolveTiming = { "queue_ms": number; "conversion_ms": number; "solve_ms": number; "result_transfer_ms": number; "redraw_ms": (number | null); "total_ms": number; "runtime_warm": boolean; "measurement_environment": string };

export type SolutionRun = { "id": ID; "model_revision": Revision; "input_hash": string; "requested_at": Timestamp; "completed_at": (Timestamp | null); "status": "running" | "converged" | "nonconverged" | "failed" | "superseded"; "solver": SolverInfo; "iterations": (number | null); "timing": (SolveTiming | null); "diagnostics": Array<Finding>; "mappings": Array<SolverMapping>; "energized_point_ids": Array<ID>; "deenergized_point_ids": Array<ID>; "quality": ResultQuality; "results": (SolutionResults | null) };

export type ExportRecord = { "id": ID; "timestamp": Timestamp; "model_revision": Revision; "solution_run_id": (ID | null); "format": "canonical_json" | "pandapower_json" | "matpower_mat" | "psse_raw_33" | "xlsx" | "csv" | "pdf"; "exporter_version": string; "warnings": Array<string>; "round_trip_status": "not_run" | "passed" | "failed" | "not_applicable"; "max_voltage_delta_pu": (number | null); "independent_reader": (string | null) };

export type StudyDocument = { "schema_version": "1.0.0"; "case_id": ID; "revision": Revision; "meta": CaseMeta; "settings": StudySettings; "source_files": Array<SourceFile>; "extraction": ExtractionWorkspace; "connectivity_points": Array<ConnectivityPoint>; "elements": Array<Element>; "review": ReviewState; "data_suggestions": Array<DataSuggestion>; "validation": (ValidationRun | null); "operation": OperationState; "solution": (SolutionRun | null); "export_history": Array<ExportRecord> };

