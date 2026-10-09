Attribute VB_Name = "NeonLED"
'==============================================================================
'  NeonLED - Automacao de artes para LED Neon no CorelDRAW (VBA / GMS)
'
'  Macros publicas (Ferramentas > Scripts / Alt+Shift+F11 para atribuir atalho):
'    NeonPainel                - menu com todas as funcoes abaixo
'    NeonTextoParaLinhaCentral - texto/imagem selecionado -> linhas centrais (PowerTRACE)
'    NeonAplicarEstilo         - aplica linha 4,7 mm, pontas/cantos redondos, sem preenchimento
'    NeonMedir                 - numera cada linha, mede, arredonda p/ multiplo de 25 mm,
'                                marca pontos de corte, gera tabela de montagem + CSV
'    NeonPreviaBrilho          - cria efeito de brilho para mostrar ao cliente
'    NeonGerarBase             - gera contorno da base (acrilico) com margem
'    NeonLimpar                - apaga as camadas geradas pelas macros
'
'  Trabalha sempre sobre os objetos SELECIONADOS (curvas; grupos sao percorridos).
'  Cada subcaminho de uma curva e tratado como uma mangueira independente.
'==============================================================================
Option Explicit

' ============================ CONFIGURACAO ===================================
Private Const ESPESSURA_MM As Double = 4.7      ' espessura da mangueira
Private Const MODULO_CORTE_MM As Double = 25    ' a mangueira so pode ser cortada a cada 25 mm
Private Const TOLERANCIA_MM As Double = 3       ' diferenca aceitavel ate o multiplo mais proximo
Private Const MARGEM_BASE_MM As Double = 15     ' distancia da linha ate a borda do acrilico
Private Const WATTS_POR_METRO As Double = 9.6   ' consumo da sua mangueira (veja ficha tecnica)
Private Const FOLGA_FONTE As Double = 1.2       ' fonte com 20% de folga
Private Const PRECO_POR_METRO As Double = 0     ' 0 = nao mostra custo
Private Const FONTE_ETIQUETA As String = "Arial"
Private Const TAM_ETIQUETA_PT As Single = 9

Private Const CAMADA_MEDIDAS As String = "NEON - Medidas"
Private Const CAMADA_CORTES As String = "NEON - Pontos de corte"
Private Const CAMADA_BRILHO As String = "NEON - Previa brilho"
Private Const CAMADA_BASE As String = "NEON - Base acrilico"
' =============================================================================

Private Type LinhaNeon
    Shp As Shape
    Idx As Long             ' indice do subcaminho dentro da curva
    Comprimento As Double   ' comprimento real desenhado (mm)
    Corte As Double         ' comprimento de corte (multiplo de 25 mm)
    X As Double             ' ponto inicial (onde vai a etiqueta)
    Y As Double
End Type

Private mUnidadeAnterior As cdrUnit

'------------------------------------------------------------------------------
'  MENU
'------------------------------------------------------------------------------
Public Sub NeonPainel()
    Dim op As String
    op = InputBox("LED NEON - escolha a acao:" & vbCr & vbCr & _
                  "1 - Texto/imagem -> linha central (PowerTRACE)" & vbCr & _
                  "2 - Aplicar estilo da mangueira (" & ESPESSURA_MM & " mm)" & vbCr & _
                  "3 - Medir, numerar e gerar tabela de montagem" & vbCr & _
                  "4 - Previa de brilho para o cliente" & vbCr & _
                  "5 - Gerar base / acrilico" & vbCr & _
                  "6 - Fazer 2 + 3 + 4 + 5 de uma vez" & vbCr & _
                  "9 - Limpar camadas geradas", "NeonLED", "3")
    Select Case Trim$(op)
        Case "1": NeonTextoParaLinhaCentral
        Case "2": NeonAplicarEstilo
        Case "3": NeonMedir
        Case "4": NeonPreviaBrilho
        Case "5": NeonGerarBase
        Case "6"
            NeonAplicarEstilo
            NeonMedir
            NeonPreviaBrilho
            NeonGerarBase
        Case "9": NeonLimpar
    End Select
End Sub

'------------------------------------------------------------------------------
'  1) TEXTO / IMAGEM -> LINHA CENTRAL
'  Substitui o trabalho manual de desenhar com B-spline por cima das letras.
'  Converte o objeto em bitmap preto e branco e roda o PowerTRACE em modo
'  "Linha central" (Centerline). Depois e so limpar/ajustar os nos.
'------------------------------------------------------------------------------
Public Sub NeonTextoParaLinhaCentral()
    If Not Preparar() Then Exit Sub
    Dim s As Shape, dup As Shape, ts As TraceSettings, res As ShapeRange
    Dim sr As ShapeRange
    Set sr = ActiveSelectionRange

    On Error GoTo Falha
    ActiveDocument.BeginCommandGroup "Neon - linha central"
    For Each s In sr
        Set dup = s.Duplicate
        If dup.Type <> cdrBitmapShape Then
            ' texto/curva: preto, sem contorno, vira bitmap 600 dpi
            On Error Resume Next
            dup.Fill.ApplyUniformFill CreateRGBColor(0, 0, 0)
            dup.Outline.SetNoOutline
            On Error GoTo Falha
            Set dup = dup.ConvertToBitmapEx(cdrGrayscaleImage, False, True, 600, cdrNormalAntiAliasing)
        End If
        Set ts = dup.Bitmap.Trace(cdrTraceLineDrawing)
        ts.Smoothing = 60
        ts.CornerSmoothness = 50
        ts.RemoveOriginalImage = True
        Set res = ts.Finish
        If Not res Is Nothing Then
            res.Ungroup
            res.SetOutlineProperties ESPESSURA_MM
        End If
    Next s
    ActiveDocument.EndCommandGroup
    Finalizar
    MsgBox "Linhas centrais criadas." & vbCr & _
           "Revise as letras (Ferramenta Forma / F10) e depois rode 'Medir'.", vbInformation, "NeonLED"
    Exit Sub
Falha:
    ActiveDocument.EndCommandGroup
    Finalizar
    MsgBox "Nao foi possivel rodar o PowerTRACE automaticamente: " & Err.Description & vbCr & _
           "Faca manualmente: Bitmaps > Traçado de linha central > Desenho de linhas.", vbExclamation, "NeonLED"
End Sub

'------------------------------------------------------------------------------
'  2) ESTILO PADRAO DA MANGUEIRA
'------------------------------------------------------------------------------
Public Sub NeonAplicarEstilo()
    If Not Preparar() Then Exit Sub
    Dim sr As ShapeRange, s As Shape
    Set sr = CurvasSelecionadas()
    If sr.Count = 0 Then Finalizar: MsgBox "Selecione as linhas do neon (curvas).", vbExclamation: Exit Sub

    ActiveDocument.BeginCommandGroup "Neon - estilo"
    For Each s In sr
        s.Fill.ApplyNoFill
        s.Outline.Width = ESPESSURA_MM
        s.Outline.LineCaps = cdrOutlineRoundLineCaps
        s.Outline.LineJoin = cdrOutlineRoundLineJoin
        s.Outline.ScaleWithShape = False
        If s.Outline.Type = cdrNoOutline Then s.Outline.Color.RGBAssign 255, 0, 200
    Next s
    ActiveDocument.EndCommandGroup
    Finalizar
End Sub

'------------------------------------------------------------------------------
'  3) MEDIR, NUMERAR, ARREDONDAR, TABELA E CSV
'------------------------------------------------------------------------------
Public Sub NeonMedir()
    If Not Preparar() Then Exit Sub
    Dim linhas() As LinhaNeon, n As Long, i As Long
    n = ColetarLinhas(linhas)
    If n = 0 Then Finalizar: MsgBox "Selecione as linhas do neon (curvas).", vbExclamation: Exit Sub

    Dim bx As Double, by As Double, bw As Double, bh As Double
    ActiveSelectionRange.GetBoundingBox bx, by, bw, bh

    ActiveDocument.BeginCommandGroup "Neon - medidas"
    Dim layMed As Layer, layCor As Layer
    Set layMed = ObterCamada(CAMADA_MEDIDAS, True)
    Set layCor = ObterCamada(CAMADA_CORTES, True)

    Dim totalReal As Double, totalCorte As Double, ajustar As Long
    Dim t As Shape, txt As String, dif As Double

    For i = 1 To n
        With linhas(i)
            totalReal = totalReal + .Comprimento
            totalCorte = totalCorte + .Corte
            dif = .Corte - .Comprimento

            txt = "L" & i & ": " & Format(.Corte, "0") & " mm"
            If Abs(dif) > TOLERANCIA_MM Then
                ajustar = ajustar + 1
                txt = txt & "  (desenho " & Format(.Comprimento, "0") & ", " & _
                      IIf(dif > 0, "+", "") & Format(dif, "0") & ")"
            End If

            Set t = layMed.CreateArtisticText(.X + 2, .Y + 3, txt, , , FONTE_ETIQUETA, TAM_ETIQUETA_PT)
            If Abs(dif) > TOLERANCIA_MM Then
                t.Fill.ApplyUniformFill CreateRGBColor(230, 120, 0)   ' laranja = ajustar
            Else
                t.Fill.ApplyUniformFill CreateRGBColor(0, 140, 60)    ' verde = ok
            End If

            ' bolinha no inicio da linha (onde entra o cabo)
            With layMed.CreateEllipse2(.X, .Y, 1.5)
                .Fill.ApplyUniformFill CreateRGBColor(0, 0, 0)
                .Outline.SetNoOutline
            End With

            MarcarCortes .Shp.Curve.SubPaths(.Idx), layCor
            If .Shp.Curve.SubPaths.Count = 1 Then .Shp.Name = "NEON L" & Format(i, "00")
        End With
    Next i

    ' ---------- tabela resumo ----------
    Dim metros As Double, w As Double, resumo As String
    metros = totalCorte / 1000
    w = metros * WATTS_POR_METRO
    resumo = "TABELA DE MONTAGEM - LED NEON" & vbCr & _
             "Mangueira " & ESPESSURA_MM & " mm | corte a cada " & MODULO_CORTE_MM & " mm" & vbCr & vbCr
    For i = 1 To n
        resumo = resumo & "L" & i & " ...... " & Format(linhas(i).Corte, "0") & " mm" & _
                 "  (" & Format(linhas(i).Corte / MODULO_CORTE_MM, "0") & " modulos)" & vbCr
    Next i
    resumo = resumo & vbCr & _
             "Quantidade de linhas: " & n & vbCr & _
             "TOTAL DE MANGUEIRA: " & Format(totalCorte, "0") & " mm  (" & Format(metros, "0.00") & " m)" & vbCr & _
             "Tamanho da arte: " & Format(bw, "0") & " x " & Format(bh, "0") & " mm" & vbCr & _
             "Consumo: " & Format(w, "0.0") & " W  ->  fonte minima " & Format(w * FOLGA_FONTE, "0") & " W"
    If PRECO_POR_METRO > 0 Then resumo = resumo & vbCr & "Custo mangueira: R$ " & Format(metros * PRECO_POR_METRO, "0.00")
    If ajustar > 0 Then resumo = resumo & vbCr & vbCr & "ATENCAO: " & ajustar & " linha(s) em laranja fora do multiplo de " & MODULO_CORTE_MM & " mm"

    Set t = layMed.CreateArtisticText(bx + bw + 20, by + bh, resumo, , , FONTE_ETIQUETA, TAM_ETIQUETA_PT + 2)
    t.TopY = by + bh

    ActiveDocument.EndCommandGroup
    ExportarCSV linhas, n, totalCorte
    Finalizar

    MsgBox n & " linhas medidas." & vbCr & _
           "Total de mangueira: " & Format(totalCorte, "0") & " mm (" & Format(metros, "0.00") & " m)" & vbCr & _
           IIf(ajustar > 0, ajustar & " linha(s) precisam de ajuste (em laranja).", "Todas as linhas estao no multiplo de " & MODULO_CORTE_MM & " mm."), _
           vbInformation, "NeonLED"
End Sub

'------------------------------------------------------------------------------
'  4) PREVIA DE BRILHO (para aprovacao do cliente)
'------------------------------------------------------------------------------
Public Sub NeonPreviaBrilho()
    If Not Preparar() Then Exit Sub
    Dim sr As ShapeRange, s As Shape, d As Shape, lay As Layer
    Set sr = CurvasSelecionadas()
    If sr.Count = 0 Then Finalizar: MsgBox "Selecione as linhas do neon (curvas).", vbExclamation: Exit Sub

    ActiveDocument.BeginCommandGroup "Neon - previa brilho"
    Set lay = ObterCamada(CAMADA_BRILHO, True)
    For Each s In sr
        CriarHalo s, lay, ESPESSURA_MM * 6, 88
        CriarHalo s, lay, ESPESSURA_MM * 3, 70
        CriarHalo s, lay, ESPESSURA_MM * 1.8, 40
    Next s
    On Error Resume Next
    lay.MoveBelow sr(1).Layer
    On Error GoTo 0
    ActiveDocument.EndCommandGroup
    Finalizar
End Sub

Private Sub CriarHalo(s As Shape, lay As Layer, largura As Double, transp As Long)
    Dim d As Shape
    Set d = s.Duplicate
    d.MoveToLayer lay
    d.Outline.Width = largura
    d.Outline.LineCaps = cdrOutlineRoundLineCaps
    d.Outline.LineJoin = cdrOutlineRoundLineJoin
    d.Transparency.ApplyUniformTransparency transp
End Sub

'------------------------------------------------------------------------------
'  5) BASE / ACRILICO - contorno que acompanha as letras
'------------------------------------------------------------------------------
Public Sub NeonGerarBase()
    If Not Preparar() Then Exit Sub
    Dim sr As ShapeRange, s As Shape, d As Shape, obj As Shape, base As Shape, lay As Layer
    Set sr = CurvasSelecionadas()
    If sr.Count = 0 Then Finalizar: MsgBox "Selecione as linhas do neon (curvas).", vbExclamation: Exit Sub

    ActiveDocument.BeginCommandGroup "Neon - base"
    Set lay = ObterCamada(CAMADA_BASE, True)
    For Each s In sr
        Set d = s.Duplicate
        d.MoveToLayer lay
        d.Fill.ApplyNoFill
        d.Outline.Width = ESPESSURA_MM + 2 * MARGEM_BASE_MM
        d.Outline.LineCaps = cdrOutlineRoundLineCaps
        d.Outline.LineJoin = cdrOutlineRoundLineJoin
        Set obj = d.ConvertOutlineToObject
        On Error Resume Next
        d.Delete                     ' em algumas versoes o original continua existindo
        On Error GoTo 0
        If base Is Nothing Then
            Set base = obj
        Else
            Set base = base.Weld(obj)
        End If
    Next s

    If Not base Is Nothing Then
        base.Fill.ApplyNoFill
        base.Outline.SetProperties 0.1, , CreateRGBColor(255, 0, 0)   ' linha fina vermelha = corte laser/router
        base.Name = "NEON Base acrilico"
        lay.MoveBelow sr(1).Layer
    End If
    ActiveDocument.EndCommandGroup
    Finalizar
    If Not base Is Nothing Then
        MsgBox "Base gerada com margem de " & MARGEM_BASE_MM & " mm." & vbCr & _
               "Tamanho: " & Format(base.SizeWidth, "0") & " x " & Format(base.SizeHeight, "0") & " mm", vbInformation, "NeonLED"
    End If
End Sub

'------------------------------------------------------------------------------
'  LIMPAR
'------------------------------------------------------------------------------
Public Sub NeonLimpar()
    If ActiveDocument Is Nothing Then Exit Sub
    ActiveDocument.BeginCommandGroup "Neon - limpar"
    ApagarCamada CAMADA_MEDIDAS
    ApagarCamada CAMADA_CORTES
    ApagarCamada CAMADA_BRILHO
    ApagarCamada CAMADA_BASE
    ActiveDocument.EndCommandGroup
End Sub

'==============================================================================
'  AUXILIARES
'==============================================================================
Private Function Preparar() As Boolean
    If ActiveDocument Is Nothing Then MsgBox "Abra um documento.", vbExclamation: Exit Function
    If ActiveSelectionRange.Count = 0 Then MsgBox "Selecione os objetos primeiro.", vbExclamation: Exit Function
    mUnidadeAnterior = ActiveDocument.Unit
    ActiveDocument.Unit = cdrMillimeter
    Optimization = True
    EventsEnabled = False
    Preparar = True
End Function

Private Sub Finalizar()
    Optimization = False
    EventsEnabled = True
    ActiveDocument.Unit = mUnidadeAnterior
    ActiveWindow.Refresh
End Sub

' Curvas selecionadas (entra em grupos), ignorando as camadas geradas
Private Function CurvasSelecionadas() As ShapeRange
    Dim todas As ShapeRange, s As Shape
    Set CurvasSelecionadas = CreateShapeRange
    Set todas = ActiveSelection.Shapes.FindShapes(Type:=cdrCurveShape)
    For Each s In todas
        If Not CamadaGerada(s.Layer.Name) Then CurvasSelecionadas.Add s
    Next s
End Function

Private Function CamadaGerada(nome As String) As Boolean
    CamadaGerada = (nome = CAMADA_MEDIDAS Or nome = CAMADA_CORTES Or _
                    nome = CAMADA_BRILHO Or nome = CAMADA_BASE)
End Function

' Cada subcaminho = uma mangueira. Ordena de cima p/ baixo, esquerda p/ direita.
Private Function ColetarLinhas(linhas() As LinhaNeon) As Long
    Dim sr As ShapeRange, s As Shape, k As Long, n As Long
    Set sr = CurvasSelecionadas()
    For Each s In sr
        n = n + s.Curve.SubPaths.Count
    Next s
    If n = 0 Then Exit Function
    ReDim linhas(1 To n)

    n = 0
    For Each s In sr
        For k = 1 To s.Curve.SubPaths.Count
            n = n + 1
            With linhas(n)
                Set .Shp = s
                .Idx = k
                .Comprimento = s.Curve.SubPaths(k).Length
                .Corte = ArredondarCorte(.Comprimento)
                .X = s.Curve.SubPaths(k).StartNode.PositionX
                .Y = s.Curve.SubPaths(k).StartNode.PositionY
            End With
        Next k
    Next s

    ' ordenacao simples (linhas de leitura com faixa de 30 mm)
    Dim i As Long, j As Long, tmp As LinhaNeon
    For i = 2 To n
        tmp = linhas(i)
        j = i - 1
        Do While j >= 1
            If Not VemAntes(tmp, linhas(j)) Then Exit Do
            linhas(j + 1) = linhas(j)
            j = j - 1
        Loop
        linhas(j + 1) = tmp
    Next i
    ColetarLinhas = n
End Function

Private Function VemAntes(a As LinhaNeon, b As LinhaNeon) As Boolean
    If Abs(a.Y - b.Y) > 30 Then
        VemAntes = (a.Y > b.Y)
    Else
        VemAntes = (a.X < b.X)
    End If
End Function

' Multiplo de 25 mm: se estiver ate TOLERANCIA acima de um multiplo, usa ele;
' senao arredonda para cima (melhor sobrar do que faltar mangueira).
Private Function ArredondarCorte(comp As Double) As Double
    Dim inferior As Double
    inferior = Int(comp / MODULO_CORTE_MM) * MODULO_CORTE_MM
    If inferior > 0 And comp - inferior <= TOLERANCIA_MM Then
        ArredondarCorte = inferior
    Else
        ArredondarCorte = inferior + MODULO_CORTE_MM
    End If
End Function

' Bolinhas vermelhas a cada 25 mm ao longo da linha (marcas de corte da mangueira)
Private Sub MarcarCortes(sp As SubPath, lay As Layer)
    Dim seg As Segment, acum As Double, alvo As Double, ofs As Double
    Dim x As Double, y As Double, c As Shape
    On Error Resume Next
    alvo = MODULO_CORTE_MM
    For Each seg In sp.Segments
        Do While alvo <= acum + seg.Length
            ofs = alvo - acum
            seg.GetPointPositionAt x, y, ofs, cdrAbsoluteSegmentOffset
            Set c = lay.CreateEllipse2(x, y, 0.8)
            c.Fill.ApplyUniformFill CreateRGBColor(255, 0, 0)
            c.Outline.SetNoOutline
            alvo = alvo + MODULO_CORTE_MM
        Loop
        acum = acum + seg.Length
    Next seg
End Sub

Private Sub ExportarCSV(linhas() As LinhaNeon, n As Long, total As Double)
    Dim pasta As String, nome As String, arq As String, f As Integer, i As Long
    pasta = ActiveDocument.FilePath
    If pasta = "" Then pasta = Environ$("USERPROFILE") & "\Desktop\"
    If Right$(pasta, 1) <> "\" Then pasta = pasta & "\"
    nome = ActiveDocument.FileName
    If InStrRev(nome, ".") > 0 Then nome = Left$(nome, InStrRev(nome, ".") - 1)
    If nome = "" Then nome = "neon"
    arq = pasta & nome & "_montagem.csv"

    On Error GoTo Falha
    f = FreeFile
    Open arq For Output As #f
    Print #f, "Linha;Corte (mm);Modulos de 25mm;Desenhado (mm)"
    For i = 1 To n
        Print #f, "L" & i & ";" & Format(linhas(i).Corte, "0") & ";" & _
                  Format(linhas(i).Corte / MODULO_CORTE_MM, "0") & ";" & Format(linhas(i).Comprimento, "0.0")
    Next i
    Print #f, "TOTAL;" & Format(total, "0") & ";" & Format(total / MODULO_CORTE_MM, "0") & ";"
    Close #f
    Exit Sub
Falha:
    MsgBox "Nao consegui salvar o CSV em " & arq & ": " & Err.Description, vbExclamation, "NeonLED"
End Sub

Private Function ObterCamada(nome As String, limpar As Boolean) As Layer
    Dim l As Layer
    For Each l In ActivePage.Layers
        If l.Name = nome Then Set ObterCamada = l: Exit For
    Next l
    If ObterCamada Is Nothing Then Set ObterCamada = ActivePage.CreateLayer(nome)
    If limpar Then
        If ObterCamada.Shapes.Count > 0 Then ObterCamada.Shapes.All.Delete
    End If
End Function

Private Sub ApagarCamada(nome As String)
    Dim l As Layer
    For Each l In ActivePage.Layers
        If l.Name = nome Then l.Delete: Exit Sub
    Next l
End Sub
