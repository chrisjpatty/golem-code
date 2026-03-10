#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

const WIN_WIDTH: f64 = 900.0;
const WIN_HEIGHT: f64 = 300.0;
const MARGIN: f64 = 0.0;

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

fn main() {
    // Accept the server URL as the first CLI argument
    // e.g. golem-overlay "http://localhost:6661?mode=overlay"
    let args: Vec<String> = std::env::args().collect();
    let url = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "http://localhost:6661?mode=overlay".to_string());

    let mut builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .setup(move |app| {
            // Hide from Dock — required for panels to appear over fullscreen apps
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("overlay")
                .expect("overlay window not found");

            // Navigate to the CLI server's frontend
            let parsed_url = url::Url::parse(&url).expect("invalid URL");
            let _ = window.navigate(parsed_url);

            // All transparent pixels are click-through
            window
                .set_ignore_cursor_events(true)
                .expect("failed to set ignore cursor events");

            // Convert NSWindow → NSPanel so it can appear over fullscreen apps
            #[cfg(target_os = "macos")]
            {
                use tauri_nspanel::{
                    WebviewWindowExt, CollectionBehavior, StyleMask, PanelLevel,
                };

                let panel = window.to_panel::<OverlayPanel>().expect("failed to convert to panel");

                panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .stationary()
                        .into(),
                );

                panel.set_level(PanelLevel::ScreenSaver.value());
                panel.show();
            }

            // Position in bottom-right corner of primary monitor
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let screen_size = monitor.size();
                let scale = monitor.scale_factor();

                let x = (screen_size.width as f64 / scale) - WIN_WIDTH - MARGIN;
                let y = (screen_size.height as f64 / scale) - WIN_HEIGHT - MARGIN;

                let _ = window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(x, y),
                ));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
