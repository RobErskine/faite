//! D2a: OS-keychain storage for the desktop shell's bearer token (decision
//! #3, docs/DESKTOP.md §2/§9) — the one place this token is ever persisted.
//! `bridge.ts` calls these three commands; nothing writes the token to
//! `localStorage` or any web storage anywhere in the JS layer.

use keyring::Entry;

const SERVICE: &str = "app.myfaite.desktop";
const USERNAME: &str = "auth-token";

fn entry() -> Result<Entry, String> {
  Entry::new(SERVICE, USERNAME).map_err(|error| error.to_string())
}

/// `None` for "nothing stored yet" (signed out), not an error — signed-out
/// is this app's normal, permanent-if-never-logged-in state.
#[tauri::command]
pub fn get_auth_token() -> Result<Option<String>, String> {
  match entry()?.get_password() {
    Ok(token) => Ok(Some(token)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
pub fn set_auth_token(token: String) -> Result<(), String> {
  entry()?.set_password(&token).map_err(|error| error.to_string())
}

/// Sign-out. Deleting an entry that was never set is not an error here —
/// the caller wants "make sure nothing is stored", which is already true.
#[tauri::command]
pub fn clear_auth_token() -> Result<(), String> {
  match entry()?.delete_credential() {
    Ok(()) => Ok(()),
    Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}
