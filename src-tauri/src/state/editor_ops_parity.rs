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

#[test]
fn fixture_version_matches_ops_version() {
    assert_eq!(parity_fixture().version, EDITOR_OPS_VERSION);
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
