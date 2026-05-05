param(
    [ValidateSet("add", "remove", "status")]
    [string]$Action = "status",
    [int]$Port = 3007,
    [string]$Name = "mirror-api $Port"
)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must be run as Administrator." -ForegroundColor Red
    exit 1
}

switch ($Action) {
    "add" {
        if (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue) {
            Write-Host "Rule '$Name' already exists." -ForegroundColor Yellow
        } else {
            New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
            Write-Host "Added inbound TCP rule for port $Port (Private profile)." -ForegroundColor Green
        }
    }
    "remove" {
        $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
        if ($rule) {
            Remove-NetFirewallRule -DisplayName $Name
            Write-Host "Removed rule '$Name'." -ForegroundColor Green
        } else {
            Write-Host "No rule named '$Name' found." -ForegroundColor Yellow
        }
    }
    "status" {
        $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
        if ($rule) {
            $rule | Select-Object DisplayName, Enabled, Direction, Action, Profile | Format-Table -AutoSize
        } else {
            Write-Host "No rule named '$Name' found." -ForegroundColor Yellow
        }
        Write-Host "Listening on port $Port :"
        Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object LocalAddress, State | Format-Table -AutoSize
    }
}
