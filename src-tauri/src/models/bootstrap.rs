use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapOverlayState {
    pub visible: bool,
    pub locked: bool,
    pub anchor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub settings: SettingsState,
    pub defaults: DefaultsPayload,
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub knob_positions: KnobPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
    pub current_mode: String,
    pub active_keys: Vec<String>,
    pub overlay: BootstrapOverlayState,
    pub key_counters: KeyCounters,
    pub key_counters_session_id: String,
    pub key_counters_revision: u64,
    pub layer_groups: LayerGroups,
    pub tab_note_overrides: TabNoteOverrides,
    pub tab_css_overrides: TabCssOverrides,
    pub editor_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultsPayload {
    pub settings: SettingsState,
    pub counter_settings: KeyCounterSettings,
}
