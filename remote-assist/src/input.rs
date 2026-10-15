//! Small Win32 input boundary. No process spawning, shell, services or elevation.
use serde_json::Value;
use std::{collections::HashSet, ffi::c_void, mem::size_of, ptr::null_mut};
#[repr(C)] #[derive(Clone, Copy)] struct Mouse { x: i32, y: i32, data: u32, flags: u32, time: u32, extra: usize }
#[repr(C)] #[derive(Clone, Copy)] struct Keyboard { vk: u16, scan: u16, flags: u32, time: u32, extra: usize }
#[repr(C)] union Payload { mouse: Mouse, key: Keyboard }
#[repr(C)] struct Input { kind: u32, data: Payload }
#[repr(C)] struct Point { x: i32, y: i32 }
#[repr(C)] struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
#[link(name = "user32")]
extern "system" {
    fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
    fn GetAsyncKeyState(key: i32) -> i16;
    fn GetSystemMetrics(index: i32) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn GetForegroundWindow() -> *mut c_void;
    fn GetWindowRect(window: *mut c_void, rect: *mut Rect) -> i32;
    fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> *mut c_void;
    fn GetUserObjectInformationW(handle: *mut c_void, index: i32, info: *mut c_void, length: u32, needed: *mut u32) -> i32;
    fn CloseDesktop(handle: *mut c_void) -> i32;
    fn SetProcessDPIAware() -> i32;
}
pub fn emergency_stop() -> bool { unsafe { GetAsyncKeyState(0x7b) < 0 } }
pub fn default_desktop() -> bool {
    unsafe {
        let desktop = OpenInputDesktop(0, 0, 0x0001);
        if desktop.is_null() { return false; }
        let mut name = [0u16; 256]; let mut needed = 0;
        let ok = GetUserObjectInformationW(desktop, 2, name.as_mut_ptr().cast(), 512, &mut needed) != 0;
        CloseDesktop(desktop);
        ok && String::from_utf16_lossy(&name[..name.iter().position(|v| *v == 0).unwrap_or(256)]) == "Default"
    }
}
fn send(input: Input) -> Result<(), Box<dyn std::error::Error>> {
    if unsafe { SendInput(1, &input, size_of::<Input>() as i32) } != 1 { return Err("Windows denied input (elevated/secure desktops unsupported)".into()); }
    Ok(())
}
fn mouse(flags: u32, x: i32, y: i32, data: u32) -> Result<(), Box<dyn std::error::Error>> {
    send(Input { kind: 0, data: Payload { mouse: Mouse { x, y, data, flags, time: 0, extra: 0 } } })
}
fn key(vk: u16, down: bool) -> Result<(), Box<dyn std::error::Error>> {
    send(Input { kind: 1, data: Payload { key: Keyboard { vk, scan: 0, flags: if down { 0 } else { 2 }, time: 0, extra: 0 } } })
}
pub struct InputGuard { keys: HashSet<u16>, buttons: HashSet<String> }
impl InputGuard {
    pub fn new() -> Self { unsafe { SetProcessDPIAware(); } Self { keys: HashSet::new(), buttons: HashSet::new() } }
    pub fn apply(&mut self, p: &Value, x: i32, y: i32, w: u32, h: u32) -> Result<(), Box<dyn std::error::Error>> {
        if !default_desktop() || emergency_stop() { return Err("Local stop / secure desktop".into()); }
        if w < 2 || h < 2 || unsafe { GetSystemMetrics(0) } != w as i32 || unsafe { GetSystemMetrics(1) } != h as i32 { return Err("Display changed; request new consent".into()); }
        let kind = p["kind"].as_str().ok_or("Invalid input kind")?;
        match kind {
            "move" => {
                let nx = p["x"].as_f64().ok_or("Invalid x")?; let ny = p["y"].as_f64().ok_or("Invalid y")?;
                if !nx.is_finite() || !ny.is_finite() || !(0.0..=1.0).contains(&nx) || !(0.0..=1.0).contains(&ny) { return Err("Coordinates outside approved display".into()); }
                let left = unsafe { GetSystemMetrics(76) }; let top = unsafe { GetSystemMetrics(77) };
                let vw = unsafe { GetSystemMetrics(78) }; let vh = unsafe { GetSystemMetrics(79) };
                if vw < 2 || vh < 2 { return Err("Invalid desktop".into()); }
                let px = x + (nx * (w-1) as f64).round() as i32;
                let py = y + (ny * (h-1) as f64).round() as i32;
                mouse(0x0001 | 0x8000 | 0x4000, ((px-left) as i64*65535/(vw-1) as i64) as i32, ((py-top) as i64*65535/(vh-1) as i64) as i32, 0)?;
            }
            "button" | "wheel" => {
                let mut cursor = Point { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut cursor) } == 0 || cursor.x < x || cursor.y < y || cursor.x >= x+w as i32 || cursor.y >= y+h as i32 { return Err("Pointer outside approved display".into()); }
                if kind == "wheel" {
                    let delta = p["delta"].as_i64().ok_or("Invalid scroll")?;
                    if delta.abs() > 1200 { return Err("Scroll out of range".into()); }
                    mouse(0x0800, 0, 0, delta as i32 as u32)?;
                } else {
                    let b = p["button"].as_str().ok_or("Invalid button")?;
                    let down = p["down"].as_bool().ok_or("Invalid button state")?;
                    let flags = match (b, down) { ("left", true) => 2, ("left", false) => 4, ("right", true) => 8, ("right", false) => 16, _ => return Err("Unsupported button".into()) };
                    if down { self.buttons.insert(b.into()); } else { self.buttons.remove(b); }
                    mouse(flags, 0, 0, 0)?;
                }
            }
            "key" => {
                let vk = p["vk"].as_u64().ok_or("Invalid key")?;
                if !(48..=90).contains(&vk) && !(96..=111).contains(&vk) && ![8,9,13,16,17,18,20,27,32,33,34,35,36,37,38,39,40,45,46].contains(&vk) { return Err("Unsupported key".into()); }
                let down = p["down"].as_bool().ok_or("Invalid key state")?;
                if down {
                    let mut r = Rect { left: 0, top: 0, right: 0, bottom: 0 };
                    if unsafe { GetWindowRect(GetForegroundWindow(), &mut r) } == 0 || r.left < x-12 || r.top < y-12 || r.right > x+w as i32+12 || r.bottom > y+h as i32+12 { return Err("Focused window outside approved primary display".into()); }
                    self.keys.insert(vk as u16);
                } else { self.keys.remove(&(vk as u16)); }
                key(vk as u16, down)?;
            }
            _ => return Err("Unsupported input".into()),
        }
        Ok(())
    }
    pub fn release(&mut self) {
        for vk in self.keys.drain() { let _ = key(vk, false); }
        for b in self.buttons.drain() { let _ = mouse(if b == "left" { 4 } else { 16 }, 0, 0, 0); }
    }
}
impl Drop for InputGuard { fn drop(&mut self) { self.release(); } }
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn input_layout_matches_win64() { assert_eq!(size_of::<Input>(), 40); }
}


// A per-Windows-session mutex prevents two helper processes controlling one machine.
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *mut c_void, initial_owner: i32, name: *const u16) -> *mut c_void;
    fn GetLastError() -> u32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}
pub struct MachineLock(*mut c_void);
impl MachineLock {
    pub fn acquire() -> Result<Self, &'static str> {
        let name: Vec<u16> = "Local\\SnapKeyRemoteAssistAttendedOnly".encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(null_mut(), 0, name.as_ptr()) };
        if handle.is_null() { return Err("Cannot acquire local assistance lock"); }
        if unsafe { GetLastError() } == 183 { unsafe { CloseHandle(handle); } return Err("Helper already running"); }
        Ok(Self(handle))
    }
}
impl Drop for MachineLock { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
