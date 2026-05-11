$exe = "c:\Users\macro\Documents\cherrycode\vela\release\0.1.1\win-unpacked\Vela.exe"
Write-Host "Starting $exe..."
$proc = Start-Process -FilePath $exe -PassThru -NoNewWindow
Write-Host "Process started with PID: $($proc.Id)"
Start-Sleep -Seconds 3

$isRunning = $null -ne (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
if ($isRunning) {
    Write-Host "✓ Application is running successfully!"
    Stop-Process -Id $proc.Id -Force
} else {
    Write-Host "✗ Application exited after startup (Exit Code: $($proc.ExitCode))"
}
