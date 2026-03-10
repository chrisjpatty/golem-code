#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

const WIN_WIDTH: f64 = 900.0;
const WIN_HEIGHT: f64 = 300.0;
const MARGIN: f64 = 0.0;

// Layout constants matching the frontend
const CAMERA_ZOOM: f64 = 180.0;
const FACE_SCALE: f64 = 0.18;
const AGENT_SPACING: f64 = 2.5;
const ANCHOR_PAD_X: f64 = 0.45;
const ANCHOR_PAD_Y: f64 = 0.55;
const HIT_RADIUS_X: f64 = 60.0;
const HIT_RADIUS_Y: f64 = 75.0; // 60 * 1.25 — taller oval
const HIT_Y_OFFSET: f64 = -4.0; // shift center up by 4px

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

// --- macOS cursor position via CoreGraphics FFI ---

#[cfg(target_os = "macos")]
mod cursor {
    #[repr(C)]
    #[derive(Debug, Copy, Clone)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    /// Returns cursor position in screen points (top-left origin).
    pub fn get_position() -> (f64, f64) {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return (0.0, 0.0);
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            (point.x, point.y)
        }
    }
}

/// Compute face center positions in CSS pixels within the overlay window.
/// Returns a vec of (x, y) positions for each agent.
fn compute_face_positions(agent_count: usize) -> Vec<(f64, f64)> {
    if agent_count == 0 {
        return vec![];
    }

    let vw = WIN_WIDTH / CAMERA_ZOOM;
    let vh = WIN_HEIGHT / CAMERA_ZOOM;

    // SceneAnchor offset in scene units
    let anchor_x = vw / 2.0 - ANCHOR_PAD_X;
    let anchor_y = -vh / 2.0 + ANCHOR_PAD_Y;

    let effective_spacing = FACE_SCALE.powf(0.7) * AGENT_SPACING;

    (0..agent_count)
        .map(|i| {
            let agent_x = -(i as f64) * effective_spacing;
            let scene_x = anchor_x + agent_x;
            let scene_y = anchor_y;

            // Project to NDC (orthographic)
            let ndc_x = scene_x / (vw / 2.0);
            let ndc_y = scene_y / (vh / 2.0);

            // NDC to CSS pixels
            let px_x = (ndc_x + 1.0) / 2.0 * WIN_WIDTH;
            let px_y = (1.0 - ndc_y) / 2.0 * WIN_HEIGHT + HIT_Y_OFFSET;

            (px_x, px_y)
        })
        .collect()
}

/// Query the CLI server's /health endpoint to get the current agent count.
fn query_agent_count(server_port: u16) -> usize {
    let url = format!("http://localhost:{}/health", server_port);
    match ureq::get(&url).call() {
        Ok(resp) => {
            if let Ok(body) = resp.into_body().read_to_string() {
                // Parse {"status":"ok","clients":N,"peers":N,"agents":N}
                if let Some(pos) = body.find("\"agents\":") {
                    let rest = &body[pos + 9..];
                    if let Some(end) = rest.find(|c: char| !c.is_ascii_digit()) {
                        if let Ok(n) = rest[..end].parse::<usize>() {
                            return n;
                        }
                    }
                }
            }
            1 // fallback: assume at least 1 agent
        }
        Err(_) => 1,
    }
}

/// Extract the server port from the URL passed as CLI arg.
fn extract_port(url: &str) -> u16 {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(6661)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let url = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "http://localhost:6661?mode=overlay".to_string());

    let server_port = extract_port(&url);

    let mut builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("overlay")
                .expect("overlay window not found");

            let parsed_url = url::Url::parse(&url).expect("invalid URL");
            let _ = window.navigate(parsed_url);

            // Start with click-through enabled
            window
                .set_ignore_cursor_events(true)
                .expect("failed to set ignore cursor events");

            // Convert NSWindow -> NSPanel for fullscreen overlay
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

            // Position in bottom-right corner
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let screen_size = monitor.size();
                let scale = monitor.scale_factor();

                let x = (screen_size.width as f64 / scale) - WIN_WIDTH - MARGIN;
                let y = (screen_size.height as f64 / scale) - WIN_HEIGHT - MARGIN;

                let _ = window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(x, y),
                ));
            }

            // Spawn cursor tracking thread — handles hit testing and
            // click-through toggling entirely from the Rust side.
            #[cfg(target_os = "macos")]
            {
                let win = window.clone();
                std::thread::spawn(move || {
                    let mut clickthrough_off = false;
                    let mut agent_count: usize = 1;
                    let mut face_positions = compute_face_positions(agent_count);
                    let mut poll_counter: u32 = 0;

                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(32));
                        poll_counter += 1;

                        // Refresh agent count every ~2 seconds
                        if poll_counter % 60 == 0 {
                            let new_count = query_agent_count(server_port);
                            if new_count != agent_count {
                                agent_count = new_count;
                                face_positions = compute_face_positions(agent_count);
                            }
                        }

                        let (cx, cy) = cursor::get_position();

                        // Get window position in logical points
                        let (wx, wy) = match win.outer_position() {
                            Ok(pos) => {
                                let scale = win.scale_factor().unwrap_or(1.0);
                                (pos.x as f64 / scale, pos.y as f64 / scale)
                            }
                            Err(_) => continue,
                        };

                        // Cursor position relative to window (in CSS pixels)
                        let local_x = cx - wx;
                        let local_y = cy - wy;

                        // Check if cursor is within window bounds
                        if local_x < 0.0 || local_x > WIN_WIDTH
                            || local_y < 0.0 || local_y > WIN_HEIGHT
                        {
                            if clickthrough_off {
                                let _ = win.set_ignore_cursor_events(true);
                                clickthrough_off = false;
                            }
                            continue;
                        }

                        // Hit test against face positions (ellipse)
                        let mut over_face = false;
                        for &(fx, fy) in &face_positions {
                            let dx = (local_x - fx) / HIT_RADIUS_X;
                            let dy = (local_y - fy) / HIT_RADIUS_Y;
                            if dx * dx + dy * dy <= 1.0 {
                                over_face = true;
                                break;
                            }
                        }

                        if over_face && !clickthrough_off {
                            let _ = win.set_ignore_cursor_events(false);
                            clickthrough_off = true;
                        } else if !over_face && clickthrough_off {
                            let _ = win.set_ignore_cursor_events(true);
                            clickthrough_off = false;
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
