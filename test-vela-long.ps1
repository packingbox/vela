$exe = "c:\Users\macro\Documents\cherrycode\vela\release\0.1.1\win-unpacked\Vela.exe"
Write-Host "Starting $exe..."
$proc = Start-Process -FilePath $exe -PassThru -NoNewWindow
Write-Host "Process started with PID: $($proc.Id)"
Write-Host "Waiting 5 seconds for potential errors..."
Start-Sleep -Seconds 5

$isRunning = $null -ne (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
if ($isRunning) {
    Write-Host "✓ Application is still running after 5 seconds!"
    Stop-Process -Id $proc.Id -Force
    Write-Host "Application terminated successfully."
} else {
    Write-Host "✗ Application exited (Exit Code: $($proc.ExitCode))"
}
