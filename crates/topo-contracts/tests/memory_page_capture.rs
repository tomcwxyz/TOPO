use serde_json::Value;
use std::{fs, path::PathBuf};
use topo_contracts::{EpistemicType, ExtractedMemoryPageProposal, MemoryHorizon};

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-fixtures/domain")
        .join(name);
    let content = fs::read_to_string(path).expect("fixture should be readable");
    serde_json::from_str(&content).expect("fixture should be valid JSON")
}

#[test]
fn memory_page_proposal_fixture_round_trips() {
    let original = fixture("memory-page-proposal-project.json");
    let parsed: ExtractedMemoryPageProposal = serde_json::from_value(original.clone())
        .expect("Memory Page proposal fixture should parse");

    assert_eq!(parsed.title, "RACK architecture decisions");
    assert_eq!(parsed.horizon, Some(MemoryHorizon::Project));
    let annotations = parsed.annotations.as_ref().expect("fixture has annotations");
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0].key, "rack.database");
    assert_eq!(annotations[0].epistemic_type, EpistemicType::Assertion);
    assert_eq!(serde_json::to_value(parsed).unwrap(), original);
}
