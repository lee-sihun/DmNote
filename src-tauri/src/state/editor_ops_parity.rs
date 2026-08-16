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

// EditorOpV1 wire kind 기대 목록 - op_kind가 serde 실태그를 돌려주므로
// 집합 동등 테스트(fixture_covers_every_op_kind)가 이 목록의 오타도 잡는다
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

fn op_kind(op: &EditorOpV1) -> String {
    // 전수성 강제 전용 match - 신규 variant 추가 시 컴파일 오류를 내
    // ALL_OP_KINDS와 fixture 케이스 갱신을 강제한다. kind 문자열의
    // 단일 원천은 serde 태그라 여기서 문자열을 복제하지 않는다
    match op {
        EditorOpV1::SetBounds { .. } => {}
        EditorOpV1::DeleteElement { .. } => {}
        EditorOpV1::PatchElement { .. } => {}
        EditorOpV1::SetKeySlot { .. } => {}
        EditorOpV1::InsertFrozenElements { .. } => {}
        EditorOpV1::ReorderElements { .. } => {}
        EditorOpV1::SetElementGroups { .. } => {}
        EditorOpV1::RenameLayerGroup { .. } => {}
    }
    serde_json::to_value(op)
        .ok()
        .and_then(|value| Some(value.get("kind")?.as_str()?.to_owned()))
        .expect("EditorOpV1 must serialize with a kind tag")
}

#[test]
fn fixture_version_matches_ops_version() {
    assert_eq!(parity_fixture().version, EDITOR_OPS_VERSION);
}

#[test]
fn fixture_covers_every_op_kind() {
    let expected: BTreeSet<String> = ALL_OP_KINDS.into_iter().map(str::to_owned).collect();
    let seen: BTreeSet<String> = parity_fixture()
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
