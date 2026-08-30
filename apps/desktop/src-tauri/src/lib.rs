#[tauri::command]
fn domain_contract_version() -> &'static str {
    topo_contracts::DOMAIN_CONTRACT_VERSION
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![domain_contract_version])
        .run(tauri::generate_context!())
        .expect("error while running TOPO");
}
