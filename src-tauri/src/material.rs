//! The window's native backdrop: Liquid Glass or vibrancy on macOS, Mica on
//! Windows 11. The UI paints solid backgrounds when none could be applied,
//! so a window never ends up see-through.

use std::sync::OnceLock;

use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Material {
    /// Solid backgrounds: Linux, Windows 10, or the effect failed.
    #[default]
    None,
    /// Liquid Glass, macOS 26 and later.
    Glass,
    /// The sidebar material of earlier macOS versions.
    Vibrancy,
    /// Mica, Windows 11.
    Mica,
}

static APPLIED: OnceLock<Material> = OnceLock::new();

/// What `apply` managed, for the UI to style itself around.
pub fn current() -> Material {
    APPLIED.get().copied().unwrap_or_default()
}

/// Puts the platform's backdrop behind the window's content. Call once, on
/// the main thread, before the window is shown.
pub fn apply(window: &WebviewWindow) -> Material {
    let material = apply_native(window);
    let _ = APPLIED.set(material);
    material
}

#[cfg(target_os = "macos")]
fn apply_native(window: &WebviewWindow) -> Material {
    use window_vibrancy::{
        LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial, NSVisualEffectState,
    };

    match window_vibrancy::apply_liquid_glass(
        window,
        LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular),
    ) {
        Ok(()) => return Material::Glass,
        Err(window_vibrancy::Error::UnsupportedPlatformVersion(_)) => {}
        Err(e) => eprintln!("Liquid Glass unavailable, using vibrancy: {e}"),
    }
    match window_vibrancy::apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    ) {
        Ok(()) => Material::Vibrancy,
        Err(e) => {
            eprintln!("Vibrancy unavailable, using solid backgrounds: {e}");
            Material::None
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_native(window: &WebviewWindow) -> Material {
    // None follows the system's light or dark setting.
    match window_vibrancy::apply_mica(window, None) {
        Ok(()) => Material::Mica,
        Err(e) => {
            eprintln!("Mica unavailable (Windows 10?), using solid backgrounds: {e}");
            Material::None
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_native(_window: &WebviewWindow) -> Material {
    Material::None
}
