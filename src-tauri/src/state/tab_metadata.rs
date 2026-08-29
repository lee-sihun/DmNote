use std::collections::HashSet;

use crate::models::{CustomTab, KeyMappings, KeyPosition, KeyPositions, KeySlot, BUILTIN_TAB_IDS};
const MAX_TAB_NAME_UTF16_UNITS: usize = 10;
/// 툴바 바에 나올 수 있는 칸 수. 창 폭이 902px 고정이라 상한이 정해져 있고,
/// 하한이 1인 것은 바가 비면 탭을 바꿀 길이 사라지기 때문이다.
/// 프론트의 tabOrder.ts MAX_BAR_SLOTS/MIN_BAR_SLOTS와 같이 움직인다
pub(crate) const MIN_BAR_SLOTS: u8 = 1;
pub(crate) const MAX_BAR_SLOTS: u8 = 4;

pub(crate) fn normalize_tab_order(order: &[String], custom_tabs: &[CustomTab]) -> Vec<String> {
    let custom_ids = custom_tabs
        .iter()
        .map(|tab| tab.id.as_str())
        .collect::<HashSet<_>>();
    let mut seen = HashSet::with_capacity(BUILTIN_TAB_IDS.len() + custom_tabs.len());
    let mut normalized = Vec::with_capacity(BUILTIN_TAB_IDS.len() + custom_tabs.len());

    for id in order {
        if (BUILTIN_TAB_IDS.contains(&id.as_str()) || custom_ids.contains(id.as_str()))
            && seen.insert(id.clone())
        {
            normalized.push(id.clone());
        }
    }

    for id in BUILTIN_TAB_IDS {
        if seen.insert(id.to_string()) {
            normalized.push(id.to_string());
        }
    }
    for tab in custom_tabs {
        if seen.insert(tab.id.clone()) {
            normalized.push(tab.id.clone());
        }
    }

    normalized
}

pub(crate) fn normalize_bar_count(bar_count: u8, tab_order: &[String]) -> u8 {
    let upper_bound = tab_order
        .len()
        .clamp(MIN_BAR_SLOTS as usize, MAX_BAR_SLOTS as usize) as u8;
    bar_count.clamp(MIN_BAR_SLOTS, upper_bound)
}

/// tabOrder가 없던 시절 데이터의 표시 순서를 되살린다.
///
/// 그때는 순서를 따로 저장하지 않고 custom_tabs 배열을 화면에서 뒤집어 그렸다.
/// 새로 만든 탭이 위로 올라오게 하려던 것이다. 그래서 배열 순서가 아니라
/// 뒤집은 순서가 사용자가 보던 순서다. 마이그레이션이 지켜야 할 것은
/// 내부 저장 순서가 아니라 사용자가 보던 화면이다.
///
/// 저장 데이터와 프리셋 둘 다 같은 시절 형식이므로 같은 함수를 쓴다.
/// 문에 따라 답이 갈리면 같은 프리셋이 들어오는 경로마다 다르게 보인다
pub(crate) fn legacy_tab_order(custom_tabs: &[CustomTab]) -> Vec<String> {
    BUILTIN_TAB_IDS
        .iter()
        .map(|id| (*id).to_string())
        .chain(custom_tabs.iter().rev().map(|tab| tab.id.clone()))
        .collect()
}

/// 탭 목록과 키 컬렉션의 짝을 맞춘다.
///
/// 구조가 어긋난 프리셋을 통째로 거절하면 예전에 열리던 파일이 영영 안 열린다.
/// 손상 복구가 customTabs 항목 하나를 떨궈도 그 모드의 키 데이터는 남으므로,
/// 그 store에서 저장한 프리셋이 바로 그 상태다.
///
/// id로 결합이 확정되는 어긋남만 비손실로 메운다. 중복 id나 개수 상한처럼
/// 대응을 추측해야 하는 손상은 손대지 않고 검증에 맡긴다
pub(crate) fn reconcile_custom_tab_metadata(
    custom_tabs: &mut Vec<CustomTab>,
    keys: &mut KeyMappings,
    key_positions: &mut KeyPositions,
) {
    // 탭에는 있는데 키 컬렉션이 없는 id. 한쪽만 있으면 길이를 맞춰야
    // keys[mode][i] <-> keyPositions[mode][i] 결합이 유지된다
    for tab in custom_tabs.iter() {
        match (
            keys.get(&tab.id).map(Vec::len),
            key_positions.get(&tab.id).map(Vec::len),
        ) {
            (Some(_), Some(_)) => {}
            (None, Some(len)) => {
                keys.insert(tab.id.clone(), vec![KeySlot::default(); len]);
            }
            (Some(len), None) => {
                key_positions.insert(tab.id.clone(), vec![KeyPosition::default(); len]);
            }
            (None, None) => {
                keys.insert(tab.id.clone(), Vec::new());
                key_positions.insert(tab.id.clone(), Vec::new());
            }
        }
    }

    // 키는 있는데 탭이 없는 고아 모드. 버리면 사용자가 짜둔 키 배치가 사라진다
    let known = custom_tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<HashSet<_>>();
    let mut orphans = keys
        .keys()
        .chain(key_positions.keys())
        .filter(|id| !BUILTIN_TAB_IDS.contains(&id.as_str()) && !known.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    orphans.sort();
    orphans.dedup();
    for id in orphans {
        keys.entry(id.clone()).or_default();
        key_positions.entry(id.clone()).or_default();
        // 이름은 아래 채우기 단계가 정한다
        custom_tabs.push(CustomTab {
            id,
            name: String::new(),
        });
    }

    // 빈 이름과 trim 후 겹치는 이름만 채운다. 멀쩡한 이름은 건드리지 않는다
    let mut taken = HashSet::with_capacity(custom_tabs.len());
    for tab in custom_tabs.iter_mut() {
        let trimmed = tab.name.trim();
        if !trimmed.is_empty() && taken.insert(trimmed.to_string()) {
            if trimmed.len() != tab.name.len() {
                tab.name = trimmed.to_string();
            }
            continue;
        }
        let mut ordinal = taken.len() + 1;
        while !taken.insert(format!("Custom {ordinal}")) {
            ordinal += 1;
        }
        tab.name = format!("Custom {ordinal}");
    }
}

pub(crate) fn validate_custom_tab_name(
    name: &str,
    custom_tabs: &[CustomTab],
    excluded_id: Option<&str>,
) -> Result<String, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("invalid-name");
    }
    if trimmed.encode_utf16().count() > MAX_TAB_NAME_UTF16_UNITS {
        return Err("name-too-long");
    }
    if BUILTIN_TAB_IDS.contains(&trimmed) {
        return Err("reserved-name");
    }
    if custom_tabs
        .iter()
        .any(|tab| Some(tab.id.as_str()) != excluded_id && tab.name.trim() == trimmed)
    {
        return Err("duplicate-name");
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tabs() -> Vec<CustomTab> {
        vec![
            CustomTab {
                id: "custom-a".to_string(),
                name: "Alpha".to_string(),
            },
            CustomTab {
                id: "custom-b".to_string(),
                name: "Beta".to_string(),
            },
        ]
    }

    #[test]
    fn normalize_tab_order_deduplicates_and_drops_unknown_ids() {
        let order = ["custom-b", "unknown", "4key", "custom-b", "5key"].map(str::to_string);

        assert_eq!(
            normalize_tab_order(&order, &tabs()),
            ["custom-b", "4key", "5key", "6key", "8key", "custom-a"]
        );
    }

    #[test]
    fn normalize_tab_order_appends_missing_builtin_ids_in_canonical_order() {
        let order = ["custom-a", "8key"].map(str::to_string);

        assert_eq!(
            normalize_tab_order(&order, &tabs()),
            ["custom-a", "8key", "4key", "5key", "6key", "custom-b"]
        );
    }

    #[test]
    fn normalize_tab_order_appends_missing_custom_ids_in_store_order() {
        let order = ["4key", "5key", "6key", "8key"].map(str::to_string);

        assert_eq!(
            normalize_tab_order(&order, &tabs()),
            ["4key", "5key", "6key", "8key", "custom-a", "custom-b"]
        );
    }

    #[test]
    fn normalize_tab_order_builds_complete_order_from_empty_input() {
        assert_eq!(
            normalize_tab_order(&[], &tabs()),
            ["4key", "5key", "6key", "8key", "custom-a", "custom-b"]
        );
    }

    #[test]
    fn normalize_bar_count_clamps_to_valid_range() {
        let order = ["4key", "5key", "6key", "8key"].map(str::to_string);

        assert_eq!(normalize_bar_count(0, &order), 1);
        assert_eq!(normalize_bar_count(5, &order), 4);
        assert_eq!(normalize_bar_count(255, &order), 4);
    }

    #[test]
    fn normalize_bar_count_clamps_to_tab_order_length() {
        let order = ["4key", "5key"].map(str::to_string);

        assert_eq!(normalize_bar_count(4, &order), 2);
    }

    #[test]
    fn validate_custom_tab_name_counts_utf16_units() {
        let ten_units = format!("{}ab", "😀".repeat(4));
        let eleven_units = format!("{}abc", "😀".repeat(4));

        assert!(validate_custom_tab_name(&ten_units, &[], None).is_ok());
        assert_eq!(
            validate_custom_tab_name(&eleven_units, &[], None),
            Err("name-too-long")
        );
    }

    #[test]
    fn validate_custom_tab_name_rejects_reserved_and_duplicate_names() {
        let tabs = tabs();

        assert_eq!(
            validate_custom_tab_name("4key", &tabs, None),
            Err("reserved-name")
        );
        assert_eq!(
            validate_custom_tab_name("Alpha", &tabs, None),
            Err("duplicate-name")
        );
        assert_eq!(
            validate_custom_tab_name("Alpha", &tabs, Some("custom-a")),
            Ok("Alpha".to_string())
        );
    }

    #[test]
    fn reconcile_adopts_orphan_modes_instead_of_dropping_key_data() {
        // 손상 복구가 customTabs 항목을 떨군 store에서 저장한 프리셋의 모습
        let mut custom_tabs = vec![CustomTab {
            id: "custom-a".to_string(),
            name: "Alpha".to_string(),
        }];
        let mut keys = KeyMappings::from([
            ("4key".to_string(), Vec::new()),
            ("custom-a".to_string(), vec![KeySlot::default()]),
            ("custom-x".to_string(), vec![KeySlot::default()]),
        ]);
        let mut positions = KeyPositions::from([
            ("4key".to_string(), Vec::new()),
            ("custom-a".to_string(), vec![KeyPosition::default()]),
            ("custom-x".to_string(), vec![KeyPosition::default()]),
        ]);

        reconcile_custom_tab_metadata(&mut custom_tabs, &mut keys, &mut positions);

        assert_eq!(
            custom_tabs
                .iter()
                .map(|tab| (tab.id.as_str(), tab.name.as_str()))
                .collect::<Vec<_>>(),
            [("custom-a", "Alpha"), ("custom-x", "Custom 2")]
        );
        // 키 데이터는 그대로 살아 있다
        assert_eq!(keys["custom-x"].len(), 1);
        assert_eq!(positions["custom-x"].len(), 1);
    }

    #[test]
    fn reconcile_pairs_missing_collections_without_breaking_index_coupling() {
        let mut custom_tabs = vec![
            CustomTab {
                id: "custom-a".to_string(),
                name: "Alpha".to_string(),
            },
            CustomTab {
                id: "custom-b".to_string(),
                name: "Beta".to_string(),
            },
        ];
        let mut keys = KeyMappings::from([(
            "custom-a".to_string(),
            vec![KeySlot::default(), KeySlot::default()],
        )]);
        let mut positions =
            KeyPositions::from([("custom-b".to_string(), vec![KeyPosition::default()])]);

        reconcile_custom_tab_metadata(&mut custom_tabs, &mut keys, &mut positions);

        assert_eq!(keys["custom-a"].len(), positions["custom-a"].len());
        assert_eq!(keys["custom-b"].len(), positions["custom-b"].len());
        assert_eq!(positions["custom-a"].len(), 2);
        assert_eq!(keys["custom-b"].len(), 1);
    }

    #[test]
    fn reconcile_only_replaces_empty_and_colliding_names() {
        let mut custom_tabs = vec![
            CustomTab {
                id: "custom-a".to_string(),
                name: "Mix".to_string(),
            },
            // trim 하면 앞 탭과 같아진다
            CustomTab {
                id: "custom-b".to_string(),
                name: "Mix ".to_string(),
            },
            CustomTab {
                id: "custom-c".to_string(),
                name: "   ".to_string(),
            },
            CustomTab {
                id: "custom-d".to_string(),
                name: "이름이 열 자를 훌쩍 넘는 탭".to_string(),
            },
        ];
        let mut keys = KeyMappings::new();
        let mut positions = KeyPositions::new();

        reconcile_custom_tab_metadata(&mut custom_tabs, &mut keys, &mut positions);

        let names = custom_tabs
            .iter()
            .map(|tab| tab.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names[0], "Mix");
        assert_ne!(names[1], "Mix");
        assert!(!names[2].trim().is_empty());
        // 길이는 입력 제약이지 데이터 불변식이 아니다. 여기서 밀어내면 안 된다
        assert_eq!(names[3], "이름이 열 자를 훌쩍 넘는 탭");
        assert_eq!(
            names.iter().collect::<HashSet<_>>().len(),
            custom_tabs.len()
        );
    }

    #[test]
    fn legacy_order_reverses_custom_tabs_to_match_old_screen() {
        // 옛 UI가 배열을 뒤집어 그렸으므로 custom-b가 custom-a보다 앞이다
        assert_eq!(
            legacy_tab_order(&tabs()),
            ["4key", "5key", "6key", "8key", "custom-b", "custom-a"]
        );
    }
}
