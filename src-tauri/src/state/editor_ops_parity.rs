use std::collections::BTreeSet;

use serde::Deserialize;

use crate::models::{AppStoreData, EditorDocumentV1, EditorOpV1, EDITOR_OPS_VERSION};

use super::editor_ops::prepare_editor_ops_transition;

// TS 테스트(tests/editor-ops-parity.test.ts)와 같은 fixture를 공유해
// "같은 op 시퀀스 -> 같은 문서" 결과 동등성을 양 구현에 고정한다.
// 여기서는 canonical 적용기(prepare_editor_ops_transition)가 소비한다
const OPS_PARITY_FIXTURE: &str = include_str!("../../../tests/fixtures/editor-ops-parity.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpsParityFixture {
    version: u16,
    #[allow(dead_code)]
    comment: String,
    cases: Vec<OpsParityCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpsParityCase {
    name: String,
    #[allow(dead_code)]
    comment: String,
    initial_document: EditorDocumentV1,
    ops: Vec<EditorOpV1>,
    expected_document: EditorDocumentV1,
}

fn parity_fixture() -> OpsParityFixture {
    serde_json::from_str(OPS_PARITY_FIXTURE).expect("ops parity fixture must deserialize")
}

fn document_json(document: &EditorDocumentV1) -> String {
    serde_json::to_string_pretty(document).expect("editor document serializes")
}

// EditorOpV1 wire kind 전수 목록 - 신규 op variant를 추가하면 아래 match가
// 컴파일 오류를 내므로 이 목록과 fixture 케이스를 함께 늘린다
const ALL_OP_KINDS: [&str; 8] = [
    "setBounds",
    "deleteElement",
    "patchElement",
    "setKeySlot",
    "insertFrozenElements",
    "reorderElements",
    "setElementGroups",
    "renameLayerGroup",
];

fn op_kind(op: &EditorOpV1) -> &'static str {
    match op {
        EditorOpV1::SetBounds { .. } => "setBounds",
        EditorOpV1::DeleteElement { .. } => "deleteElement",
        EditorOpV1::PatchElement { .. } => "patchElement",
        EditorOpV1::SetKeySlot { .. } => "setKeySlot",
        EditorOpV1::InsertFrozenElements { .. } => "insertFrozenElements",
        EditorOpV1::ReorderElements { .. } => "reorderElements",
        EditorOpV1::SetElementGroups { .. } => "setElementGroups",
        EditorOpV1::RenameLayerGroup { .. } => "renameLayerGroup",
    }
}

#[test]
fn fixture_version_matches_ops_version() {
    assert_eq!(parity_fixture().version, EDITOR_OPS_VERSION);
}

#[test]
fn fixture_covers_every_op_kind() {
    let expected: BTreeSet<&str> = ALL_OP_KINDS.into_iter().collect();
    let seen: BTreeSet<&str> = parity_fixture()
        .cases
        .iter()
        .flat_map(|case| case.ops.iter().map(op_kind))
        .collect();
    assert_eq!(
        seen, expected,
        "fixture must exercise every EditorOpV1 kind"
    );
}

#[test]
fn same_op_sequence_produces_same_document() {
    let fixture = parity_fixture();
    assert!(!fixture.cases.is_empty());

    for case in &fixture.cases {
        let mut store = AppStoreData::default();
        case.initial_document.apply_to_store(&mut store);

        let prepared = prepare_editor_ops_transition(&store, &case.ops)
            .unwrap_or_else(|error| panic!("case {}: ops rejected: {error:?}", case.name));

        // store 왕복이 fixture 문서를 왜곡하지 않는지부터 고정
        assert_eq!(
            prepared.current, case.initial_document,
            "case {}: initial document round-trip",
            case.name
        );

        if prepared.candidate != case.expected_document {
            panic!(
                "case {}: canonical apply diverged from shared fixture\nactual: {}\nexpected: {}",
                case.name,
                document_json(&prepared.candidate),
                document_json(&case.expected_document),
            );
        }
    }
}
