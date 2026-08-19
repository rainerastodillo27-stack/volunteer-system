# Migration Script: Apply Rainer Copy Design & remove rainer copy folder

$src = "rainer copy"
$dest = "."

Write-Host "1. Copying Assets..." -ForegroundColor Cyan
Copy-Item -Path "$src\assets\*" -Destination "assets\" -Recurse -Force

Write-Host "2. Copying Components..." -ForegroundColor Cyan
Copy-Item -Path "$src\components\*" -Destination "components\" -Recurse -Force

Write-Host "3. Copying Utils..." -ForegroundColor Cyan
Copy-Item -Path "$src\utils\*" -Destination "utils\" -Recurse -Force

Write-Host "4. Copying Screens (preserving Firebase CommunicationHubScreen.tsx)..." -ForegroundColor Cyan
$screenFiles = Get-ChildItem -Path "$src\screens" -Filter "*.tsx"
foreach ($file in $screenFiles) {
    if ($file.Name -eq "CommunicationHubScreen.tsx") {
        Write-Host "   -> Preserving existing Firebase CommunicationHubScreen.tsx" -ForegroundColor Yellow
        continue
    }
    Copy-Item -Path $file.FullName -Destination "screens\$($file.Name)" -Force
}

Write-Host "5. Fixing vector-icons imports across screens and components..." -ForegroundColor Cyan
$targets = Get-ChildItem -Path "screens", "components" -Recurse -Include "*.tsx", "*.ts"
foreach ($target in $targets) {
    $content = Get-Content -Path $target.FullName -Raw
    if ($content -match "react-native-vector-icons") {
        $fixed = $content `
            -replace "import\s+MaterialIcons\s+from\s+['""]react-native-vector-icons/MaterialIcons['""];?", "import { MaterialIcons } from '@expo/vector-icons';" `
            -replace "import\s+Ionicons\s+from\s+['""]react-native-vector-icons/Ionicons['""];?", "import { Ionicons } from '@expo/vector-icons';" `
            -replace "import\s+MaterialCommunityIcons\s+from\s+['""]react-native-vector-icons/MaterialCommunityIcons['""];?", "import { MaterialCommunityIcons } from '@expo/vector-icons';"
        Set-Content -Path $target.FullName -Value $fixed -NoNewline
        Write-Host "   Fixed imports in $($target.Name)" -ForegroundColor Green
    }
}

Write-Host "6. Removing rainer copy directory..." -ForegroundColor Cyan
Remove-Item -Path "$src" -Recurse -Force

Write-Host "Migration completed successfully!" -ForegroundColor Green
