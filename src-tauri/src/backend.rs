use command_group::{CommandGroup, GroupChild};
use std::{io::{BufRead, BufReader}, process::{Command, Stdio}, sync::mpsc, time::Duration};

pub struct BackendProcess { child: GroupChild }
impl Drop for BackendProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl BackendProcess {
    pub fn start(command: &mut Command, timeout: Duration) -> Result<(Self, String), String> {
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        let child = command.group_spawn().map_err(|error| error.to_string())?;
        // Establish ownership before any fallible operation, including readiness parsing.
        let mut owned = Self { child };
        let stdout = owned.child.inner().stdout.take().ok_or("Missing backend stdout")?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) if line.starts_with("LVCE_TAURI_READY ") => {
                        let _ = sender.send(line[17..].to_owned());
                    }
                    Ok(line) => eprintln!("{line}"),
                    Err(_) => break,
                }
            }
        });
        match receiver.recv_timeout(timeout) {
            Ok(url) if url.starts_with("http://127.0.0.1:") => Ok((owned, url)),
            result => Err(format!("Backend failed to become ready: {result:?}")),
        }
    }
    pub fn id(&self) -> u32 { self.child.id() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};
    fn temp_file(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tauri-{name}-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
    }
    fn assert_dead(pid: u32) {
        let result = Command::new("node").args(["-e", "try { process.kill(Number(process.argv[1]), 0); process.exit(1) } catch(e) { process.exit(e.code === 'ESRCH' ? 0 : 2) }", &pid.to_string()]).status().unwrap();
        assert!(result.success(), "Process {pid} survived cleanup");
    }
    #[test]
    fn rejects_failed_startup() {
        let mut command = Command::new("node");
        command.args(["-e", "process.exit(42)"]);
        assert!(BackendProcess::start(&mut command, Duration::from_secs(5)).is_err());
    }
    #[test]
    fn drop_stops_parent_and_descendant() {
        let path = temp_file("descendant");
        let script = "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); require('fs').writeFileSync(process.argv[1], String(c.pid)); console.log('LVCE_TAURI_READY http://127.0.0.1:1234/'); setInterval(()=>{},1000)";
        let mut command = Command::new("node");
        command.args(["-e", script]).arg(&path);
        let (owned, _) = BackendProcess::start(&mut command, Duration::from_secs(10)).unwrap();
        let parent = owned.id();
        let child: u32 = fs::read_to_string(&path).unwrap().parse().unwrap();
        drop(owned);
        assert_dead(parent);
        assert_dead(child);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn timeout_cleans_up_process() {
        let path = temp_file("timeout");
        let mut command = Command::new("node");
        command.args(["-e", "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},1000)"]).arg(&path);
        assert!(BackendProcess::start(&mut command, Duration::from_secs(2)).is_err());
        let pid = fs::read_to_string(&path).unwrap().parse().unwrap();
        assert_dead(pid);
        fs::remove_file(path).unwrap();
    }
}
