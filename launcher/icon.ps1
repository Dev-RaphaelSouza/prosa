# Desenha o ícone do Prosa (dois balões de conversa sobre um quadrado arredondado em degradê) e grava:
#   prosa.ico  - vários tamanhos, pro executável e pro atalho
#   prosa.png  - 256 px, embutido no Prosa.exe pra aparecer na janela
# O desenho é vetorial (XAML) e é refeito em cada tamanho, então fica nítido do 16 ao 256.
#   -Preview <pasta>  também salva um PNG por tamanho, pra conferir no olho.
param([string]$Preview = '')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase, System.Xaml

# Fundo comum aos dois desenhos: degradê, luz vindo de cima à esquerda, sombra embaixo e um fio de brilho na borda.
$background = @'
  <Rectangle Width='244' Height='244' Canvas.Left='6' Canvas.Top='6' RadiusX='62' RadiusY='62'>
    <Rectangle.Fill>
      <LinearGradientBrush StartPoint='0.15,0' EndPoint='0.85,1'>
        <GradientStop Color='#BBA8FF' Offset='0'/>
        <GradientStop Color='#8E76FF' Offset='0.42'/>
        <GradientStop Color='#5B3DE8' Offset='1'/>
      </LinearGradientBrush>
    </Rectangle.Fill>
  </Rectangle>
  <Rectangle Width='244' Height='244' Canvas.Left='6' Canvas.Top='6' RadiusX='62' RadiusY='62'>
    <Rectangle.Fill>
      <RadialGradientBrush Center='0.22,0.08' GradientOrigin='0.22,0.08' RadiusX='0.85' RadiusY='0.75'>
        <GradientStop Color='#70FFFFFF' Offset='0'/>
        <GradientStop Color='#00FFFFFF' Offset='1'/>
      </RadialGradientBrush>
    </Rectangle.Fill>
  </Rectangle>
  <Rectangle Width='244' Height='244' Canvas.Left='6' Canvas.Top='6' RadiusX='62' RadiusY='62'>
    <Rectangle.Fill>
      <LinearGradientBrush StartPoint='0,0.5' EndPoint='0,1'>
        <GradientStop Color='#00160A5C' Offset='0'/>
        <GradientStop Color='#59160A5C' Offset='1'/>
      </LinearGradientBrush>
    </Rectangle.Fill>
  </Rectangle>
  <Rectangle Width='241' Height='241' Canvas.Left='7.5' Canvas.Top='7.5' RadiusX='60.5' RadiusY='60.5' StrokeThickness='3'>
    <Rectangle.Stroke>
      <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
        <GradientStop Color='#73FFFFFF' Offset='0'/>
        <GradientStop Color='#00FFFFFF' Offset='0.55'/>
      </LinearGradientBrush>
    </Rectangle.Stroke>
  </Rectangle>
'@

$bubbleFill = @'
    <Path.Fill>
      <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
        <GradientStop Color='#FFFFFF' Offset='0'/>
        <GradientStop Color='#E9E2FF' Offset='1'/>
      </LinearGradientBrush>
    </Path.Fill>
'@

$dotFill = @'
    <Ellipse.Fill>
      <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
        <GradientStop Color='#9A84FF' Offset='0'/>
        <GradientStop Color='#5B3DE8' Offset='1'/>
      </LinearGradientBrush>
    </Ellipse.Fill>
'@

function Dot([double]$x, [double]$y, [double]$r) {
    "<Ellipse Width='$(2 * $r)' Height='$(2 * $r)' Canvas.Left='$($x - $r)' Canvas.Top='$($y - $r)'>$dotFill</Ellipse>"
}

$open = "<Canvas xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Width='256' Height='256'>"

# Tamanhos grandes: um balão translúcido atrás e o balão branco na frente, com sombra e os três pontinhos.
$full = $open + $background + @"
  <Path Fill='#5CFFFFFF' Data='M124,50 H184 A26,26 0 0 1 210,76 V136 Q210,146 201,141 L182,128 H124 A26,26 0 0 1 98,102 V76 A26,26 0 0 1 124,50 Z'/>
  <Path Data='M76,96 H148 A30,30 0 0 1 178,126 V156 A30,30 0 0 1 148,186 H104 L76,208 Q66,215 66,203 V184.3 A30,30 0 0 1 46,156 V126 A30,30 0 0 1 76,96 Z'>
    $bubbleFill
    <Path.Effect><DropShadowEffect Color='#1E0F6E' BlurRadius='22' ShadowDepth='7' Direction='270' Opacity='0.5'/></Path.Effect>
  </Path>
  $(Dot 84 141 9.5) $(Dot 112 141 9.5) $(Dot 140 141 9.5)
</Canvas>
"@

# Tamanhos pequenos: um balão só, maior e mais simples, pra continuar legível em 16 px.
$small = $open + $background + @"
  <Path Data='M88,62 H168 A38,38 0 0 1 206,100 V134 A38,38 0 0 1 168,172 H118 L84,202 Q70,212 70,196 V167.5 A38,38 0 0 1 50,134 V100 A38,38 0 0 1 88,62 Z'>
    $bubbleFill
    <Path.Effect><DropShadowEffect Color='#1E0F6E' BlurRadius='16' ShadowDepth='6' Direction='270' Opacity='0.4'/></Path.Effect>
  </Path>
  $(Dot 92 117 14) $(Dot 128 117 14) $(Dot 164 117 14)
</Canvas>
"@

function Render([string]$xaml, [int]$size) {
    $box = New-Object System.Windows.Controls.Viewbox
    $box.Child = [System.Windows.Markup.XamlReader]::Parse($xaml)
    $box.Measure((New-Object System.Windows.Size $size, $size))
    $box.Arrange((New-Object System.Windows.Rect 0, 0, $size, $size))
    $box.UpdateLayout()
    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap $size, $size, 96, 96, ([System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($box)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = New-Object System.IO.MemoryStream
    $encoder.Save($stream)
    return ,$stream.ToArray()
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$images = $sizes | ForEach-Object { ,(Render $(if ($_ -le 32) { $small } else { $full }) $_) }

# O .ico: cabeçalho, uma entrada de 16 bytes por tamanho e, depois, as imagens (em PNG).
$out = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $out
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $side = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$side); $writer.Write([byte]$side); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($image in $images) { $writer.Write($image) }
[System.IO.File]::WriteAllBytes("$PSScriptRoot\prosa.ico", $out.ToArray())
[System.IO.File]::WriteAllBytes("$PSScriptRoot\prosa.png", $images[$sizes.Count - 1])
"ícone desenhado: $PSScriptRoot\prosa.ico ($($sizes -join ', ') px)"

if ($Preview) {
    New-Item -ItemType Directory -Force $Preview | Out-Null
    for ($i = 0; $i -lt $sizes.Count; $i++) { [System.IO.File]::WriteAllBytes("$Preview\icone-$($sizes[$i]).png", $images[$i]) }
    # Uma folha só com todos os tamanhos lado a lado, os pequenos ampliados, sobre fundo escuro e claro.
    Add-Type -AssemblyName System.Drawing
    $sheet = New-Object System.Drawing.Bitmap 1180, 620
    $g = [System.Drawing.Graphics]::FromImage($sheet)
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#1b1d27'))
    $g.FillRectangle([System.Drawing.Brushes]::WhiteSmoke, 0, 310, 1180, 310)
    foreach ($row in 0, 310) {
        $x = 20
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $img = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream (,$images[$i])))
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            # Em cima, no tamanho real; embaixo, os pequenos ampliados 4x pra ver os pixels.
            $g.DrawImage($img, $x, $row + 14, $sizes[$i], $sizes[$i])
            if ($sizes[$i] -le 48) { $g.DrawImage($img, $x, $row + 90, $sizes[$i] * 4, $sizes[$i] * 4) }
            $x += [Math]::Max($sizes[$i], $(if ($sizes[$i] -le 48) { $sizes[$i] * 4 } else { 0 })) + 18
            $img.Dispose()
        }
    }
    $g.Dispose()
    $sheet.Save("$Preview\icone-folha.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $sheet.Dispose()
    "prévia: $Preview"
}
