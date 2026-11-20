; Close a running SEO Audit before the uninstaller starts deleting things.
;
; The failure this is for, from NSIS's own template: the "Already Installed"
; page runs the *previous* uninstaller with `ExecWait`, and then reports
; "Unable to uninstall!" and aborts when either the exit code is non-zero or
; `$INSTDIR\seo-audit.exe` is still on disk afterwards. Windows will not let a
; running program's .exe be deleted, so an update started while the app is open
; leaves that binary exactly where it was and the installer stops. Reported as
; issue #1, by somebody who had pressed Download in the app's own update dialog
; and therefore still had it running.
;
; Tauri's template does check whether the app is running — `CheckIfAppIsRunning`
; is inserted in the Install and Uninstall sections — but both of those come
; after the reinstall page has already run the old uninstaller and judged the
; result. This hook is the first thing the uninstall does.
;
; `taskkill` rather than a process plugin: it ships with Windows, and this
; project does not take a dependency it can avoid. `/T` ends the tree, which is
; how the engine goes with it — the shell spawns a Node process, and a surviving
; child holding a handle in the install directory would produce the very failure
; this exists to prevent. Never a bare `taskkill /IM node.exe`, which would kill
; whatever else the machine happened to be running.
;
; `/F` because an uninstaller has no polite way to wait for a window to agree to
; close, and nothing is lost by not asking: every report is written to disk as
; the run finishes, long before anybody presses anything.
;
; The result is deliberately ignored. "There is no such process" is the ordinary
; case — most people close the app first — and it is not a reason to fail an
; uninstall.
;
; KNOWN LIMIT, and it is the important one: this hook ships inside the
; uninstaller of the version that carries it. It can only run when *this*
; version is the one being removed. Anybody currently on 1.38.x or 1.39.0 has an
; uninstaller that was built without it, so their next update can still fail the
; same way — for them the answer is to close the app first, or to uninstall from
; Settings before running the installer. Nothing shipped now can reach back into
; an uninstaller that is already on disk.

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Closing SEO Audit if it is running…"
  nsExec::Exec 'taskkill /F /T /IM "seo-audit.exe"'
  Pop $0
  ; A moment for Windows to release the file handles before the delete loop
  ; starts. Without it the kill and the first DeleteFile can race, which is the
  ; same lost race in a shorter dress.
  Sleep 700
!macroend
