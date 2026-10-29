param(
    [ValidateSet('pack','merge')][string]$Action = 'pack',
    [string]$Source, [string]$Packet, [string]$ReviewerA, [string]$ReviewerB,
    [string]$Adjudications, [string]$Evidence,
    [string]$PrivateRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FreelanceChain\AI-Studies'),
    [string]$NodePath = 'node',
    [string]$OutputName = ('study-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6))
)
$ErrorActionPreference = 'Stop'
if ($OutputName -notmatch '^[a-zA-Z0-9_-]{3,80}$') { throw 'Use a plain new output folder name.' }
$nodeCommand = Get-Command -Name $NodePath -CommandType Application -ErrorAction Stop
$parameters = @((Join-Path $PSScriptRoot '..\reviewWorkflow.js'), $Action)
if ($Action -eq 'pack') {
    if (-not $Source) { throw 'Supply -Source with the private label-free collection JSON path.' }
    $parameters += @('--source', $Source)
} else {
    if (-not $Packet -or -not $ReviewerA -or -not $ReviewerB -or -not $Evidence) { throw 'Supply -Packet, -ReviewerA, -ReviewerB and -Evidence.' }
    $parameters += @('--packet', $Packet, '--reviewer-a', $ReviewerA, '--reviewer-b', $ReviewerB, '--evidence', $Evidence)
    if ($Adjudications) { $parameters += @('--adjudications', $Adjudications) }
}
$directory = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($PrivateRoot))
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
if ($directory.FullName -eq $repo -or $directory.FullName.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep the private study root outside the repository.' }
if (-not $directory.Exists) { [void]$directory.Create() }
$directory.Refresh()
if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The private study root must not be a link or junction.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$accessSection = [Security.AccessControl.AccessControlSections]::Access
$acl = [Security.AccessControl.DirectorySecurity]::new()
# DACL only: no owner changes or privileged audit/SACL access. Children inherit restrictions.
$acl.SetSecurityDescriptorSddlForm("D:P(A;OICI;FA;;;$identity)(A;OICI;FA;;;SY)", $accessSection)
if ($PSVersionTable.PSEdition -eq 'Desktop') { $directory.SetAccessControl($acl) }
else { [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl) }
$verified = [Security.AccessControl.DirectorySecurity]::new($directory.FullName, $accessSection)
$rules = @($verified.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$expected = @($identity, 'S-1-5-18') | Select-Object -Unique
if (-not $verified.AreAccessRulesProtected -or $rules.Count -ne $expected.Count) { throw 'Private study permissions could not be verified.' }
foreach ($sid in $expected) {
    $match = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
    if ($match.Count -ne 1 -or $match[0].AccessControlType -ne 'Allow' -or
        $match[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $match[0].InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or
        $match[0].PropagationFlags -ne 'None') { throw 'Private study permissions could not be verified.' }
}
$previousRoot = $env:FC_PRIVATE_RESEARCH_ROOT
$env:FC_PRIVATE_RESEARCH_ROOT = $directory.FullName
$parameters += @('--out', (Join-Path $directory.FullName $OutputName))
try {
    & $nodeCommand.Source @parameters
    if ($LASTEXITCODE -ne 0) { throw 'Study workflow incomplete. Share only the safe error text, not private input data.' }
} finally {
    if ($null -eq $previousRoot) { Remove-Item Env:\FC_PRIVATE_RESEARCH_ROOT -ErrorAction SilentlyContinue }
    else { $env:FC_PRIVATE_RESEARCH_ROOT = $previousRoot }
}
