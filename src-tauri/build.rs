fn main() {
    tauri_build::build();

    // Les binaires de test (cargo test) n'embarquent pas le manifest de
    // l'application : sans la dépendance Common-Controls v6, Windows charge
    // comctl32 v5 et SetWindowSubclass (importé par tao/wry dès qu'une
    // commande référence AppHandle::emit) est introuvable — le binaire de
    // test refuse alors de se charger (STATUS_ENTRYPOINT_NOT_FOUND).
    // Le linker émet un manifest EXTERNE (<exe>.manifest) à côté des
    // binaires de test (qui n'ont pas de RT_MANIFEST embarqué) ; le binaire
    // principal, lui, garde le manifeste embarqué de tauri-build (une
    // double ressource RT_MANIFEST ferait échouer l'édition de liens).
    println!(
        "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' publicKeyToken='6595b64144ccf1df' language='*' processorArchitecture='*'"
    );
}
