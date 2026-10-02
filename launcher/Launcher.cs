// O "Prosa.exe": uma janela com um botão de ligar. Ele sobe o servidor, abre um túnel da Cloudflare
// e mostra o link pra mandar pros amigos. Fechar a janela desliga tudo.
//
// É compilado com o csc que já vem no Windows (por isso C# 5: nada de $"" nem de ?.). Ver build.ps1.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace Prosa
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool first;
            using (new Mutex(true, "Prosa.Launcher", out first))
            {
                if (!first)
                {
                    MessageBox.Show("O Prosa já está aberto. Procure a janela dele na barra de tarefas.", "Prosa");
                    return;
                }
                // O padrão do .NET Framework pode ser um TLS antigo, que a Cloudflare recusa.
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                new Application().Run(new Launcher(Array.IndexOf(args, "--start") >= 0));
            }
        }
    }

    /// <summary>Erro com uma mensagem que faz sentido mostrar pra pessoa.</summary>
    class Friendly : Exception
    {
        public Friendly(string message) : base(message) { }
    }

    class Launcher : Window
    {
        const int Port = 3001;
        const string Local = "http://localhost:3001";

        const string Xaml = @"
<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'
      Background='#0E1017' TextElement.FontFamily='Segoe UI Variable Display, Segoe UI' TextElement.Foreground='#ECEEF6'>
  <Grid.Resources>
    <Style x:Key='Power' TargetType='Button'>
      <Setter Property='Foreground' Value='White'/>
      <Setter Property='Background' Value='#8F7BFF'/>
      <Setter Property='BorderBrush' Value='Transparent'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='RenderTransformOrigin' Value='0.5,0.5'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <Grid>
              <Ellipse x:Name='face' Fill='{TemplateBinding Background}' Stroke='{TemplateBinding BorderBrush}' StrokeThickness='3'/>
              <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
            </Grid>
            <ControlTemplate.Triggers>
              <Trigger Property='IsMouseOver' Value='True'>
                <Setter TargetName='face' Property='Opacity' Value='0.88'/>
              </Trigger>
              <Trigger Property='IsPressed' Value='True'>
                <Setter Property='RenderTransform'>
                  <Setter.Value><ScaleTransform ScaleX='0.96' ScaleY='0.96'/></Setter.Value>
                </Setter>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key='Pill' TargetType='Button'>
      <Setter Property='Foreground' Value='#ECEEF6'/>
      <Setter Property='Background' Value='#262A3D'/>
      <Setter Property='FontSize' Value='13'/>
      <Setter Property='FontWeight' Value='SemiBold'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Height' Value='38'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <Border x:Name='box' Background='{TemplateBinding Background}' CornerRadius='10'>
              <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property='IsMouseOver' Value='True'>
                <Setter TargetName='box' Property='Opacity' Value='0.85'/>
              </Trigger>
              <Trigger Property='IsEnabled' Value='False'>
                <Setter TargetName='box' Property='Opacity' Value='0.4'/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key='Link' TargetType='Button'>
      <Setter Property='Foreground' Value='#6D7389'/>
      <Setter Property='FontSize' Value='12'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <ContentPresenter/>
            <ControlTemplate.Triggers>
              <Trigger Property='IsMouseOver' Value='True'>
                <Setter Property='Foreground' Value='#ECEEF6'/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Grid.Resources>

  <StackPanel Margin='28,20,28,22'>
    <StackPanel Orientation='Horizontal' HorizontalAlignment='Center'>
      <Image x:Name='logo' Width='52' Height='52' RenderOptions.BitmapScalingMode='HighQuality'/>
      <StackPanel Margin='12,0,0,0' VerticalAlignment='Center'>
        <TextBlock Text='Prosa' FontSize='24' FontWeight='Bold'/>
        <TextBlock Text='Puxa uma cadeira.' FontSize='12.5' Foreground='#6D7389'/>
      </StackPanel>
    </StackPanel>

    <Grid Width='196' Height='196' Margin='0,24,0,4'>
      <Ellipse x:Name='halo' Fill='#8F7BFF' Opacity='0.12'/>
      <Ellipse x:Name='spinner' Width='178' Height='178' Stroke='#8F7BFF' StrokeThickness='3' StrokeDashArray='14 44.6' StrokeDashCap='Round'
               Visibility='Collapsed' RenderTransformOrigin='0.5,0.5'>
        <Ellipse.RenderTransform><RotateTransform/></Ellipse.RenderTransform>
      </Ellipse>
      <Button x:Name='power' Style='{StaticResource Power}' Width='152' Height='152'>
        <StackPanel>
          <TextBlock x:Name='powerIcon' Text='&#xE7E8;' FontFamily='Segoe Fluent Icons, Segoe MDL2 Assets' FontSize='38' HorizontalAlignment='Center'/>
          <TextBlock x:Name='powerText' Text='Ligar' FontSize='16' FontWeight='SemiBold' HorizontalAlignment='Center' Margin='0,8,0,0'/>
        </StackPanel>
      </Button>
    </Grid>

    <StackPanel Orientation='Horizontal' HorizontalAlignment='Center' Margin='0,8,0,0'>
      <Ellipse x:Name='dot' Width='9' Height='9' Fill='#6D7389' VerticalAlignment='Center'/>
      <TextBlock x:Name='status' Text='Desligado' FontSize='14' FontWeight='SemiBold' Margin='8,0,0,0'/>
    </StackPanel>
    <TextBlock x:Name='detail' FontSize='12.5' Foreground='#A8ADC2' TextWrapping='Wrap' TextAlignment='Center' Margin='0,6,0,0'
               Text='Aperte Ligar pra pôr o Prosa no ar e pegar o link.'/>

    <Border Background='#161822' BorderBrush='#22FFFFFF' BorderThickness='1' CornerRadius='14' Padding='16,14,16,16' Margin='0,20,0,0'>
      <StackPanel>
        <TextBlock Text='LINK PRA MANDAR PROS AMIGOS' FontSize='10.5' FontWeight='Bold' Foreground='#6D7389'/>
        <TextBox x:Name='link' IsReadOnly='True' BorderThickness='0' Background='Transparent' Foreground='#6D7389' FontSize='14'
                 TextWrapping='Wrap' Padding='0' Margin='-2,8,0,0' Text='Aparece aqui quando o Prosa estiver no ar.'/>
        <Grid Margin='0,14,0,0'>
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width='*'/>
            <ColumnDefinition Width='10'/>
            <ColumnDefinition Width='*'/>
          </Grid.ColumnDefinitions>
          <Button x:Name='copy' Grid.Column='0' Style='{StaticResource Pill}' Background='#8F7BFF' Foreground='White' Content='Copiar link' IsEnabled='False'/>
          <Button x:Name='open' Grid.Column='2' Style='{StaticResource Pill}' Content='Abrir no meu navegador' IsEnabled='False'/>
        </Grid>
      </StackPanel>
    </Border>

    <TextBlock FontSize='12' Foreground='#6D7389' TextWrapping='Wrap' TextAlignment='Center' Margin='0,16,0,0'
               Text='Deixe esta janela aberta enquanto vocês usam. Fechar desliga o Prosa pra todo mundo — as contas e as mensagens ficam guardadas.'/>
    <Button x:Name='more' Style='{StaticResource Link}' Content='Mostrar detalhes' HorizontalAlignment='Center' Margin='0,12,0,0'/>
    <TextBox x:Name='log' Visibility='Collapsed' IsReadOnly='True' Height='150' Margin='0,10,0,0' Background='#0B0C11' Foreground='#A8ADC2'
             BorderBrush='#22FFFFFF' FontFamily='Consolas' FontSize='11' Padding='8' VerticalScrollBarVisibility='Auto'
             HorizontalScrollBarVisibility='Auto'/>
  </StackPanel>
</Grid>";

        enum State { Off, Starting, On }

        static readonly Regex TunnelUrl = new Regex(@"https://[a-z0-9-]+\.trycloudflare\.com", RegexOptions.IgnoreCase);
        static readonly Brush Accent = Paint("#8F7BFF");
        static readonly Brush Green = Paint("#2FD4A7");
        static readonly Brush Amber = Paint("#F5B942");
        static readonly Brush Red = Paint("#FF5A6E");
        static readonly Brush Grey = Paint("#6D7389");
        static readonly Brush Panel = Paint("#1E2130");

        readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        readonly IntPtr job;
        readonly object logLock = new object();
        readonly List<string> lines = new List<string>();
        readonly bool autoStart;

        readonly Button power, copy, open, more;
        readonly TextBlock powerIcon, powerText, status, detail;
        readonly TextBox link, log;
        readonly Ellipse dot, halo, spinner;

        State state = State.Off;
        // Cada "ligar" é uma rodada. Cancelar ou desligar passa pra próxima, e o que estava esperando percebe e desiste.
        int round;
        string url;
        volatile bool tunnelReady;
        StreamWriter logFile;

        public Launcher(bool autoStart)
        {
            this.autoStart = autoStart;
            Title = "Prosa";
            Width = 420;
            SizeToContent = SizeToContent.Height;
            ResizeMode = ResizeMode.CanMinimize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = Paint("#0E1017");
            UseLayoutRounding = true;

            var ui = (Grid)XamlReader.Parse(Xaml);
            Content = ui;
            power = (Button)ui.FindName("power");
            copy = (Button)ui.FindName("copy");
            open = (Button)ui.FindName("open");
            more = (Button)ui.FindName("more");
            powerIcon = (TextBlock)ui.FindName("powerIcon");
            powerText = (TextBlock)ui.FindName("powerText");
            status = (TextBlock)ui.FindName("status");
            detail = (TextBlock)ui.FindName("detail");
            link = (TextBox)ui.FindName("link");
            log = (TextBox)ui.FindName("log");
            dot = (Ellipse)ui.FindName("dot");
            halo = (Ellipse)ui.FindName("halo");
            spinner = (Ellipse)ui.FindName("spinner");

            job = CreateKillOnCloseJob();

            // Sobra de uma recompilação feita com o Prosa aberto (ver build.ps1): agora já dá pra apagar.
            try { File.Delete(System.IO.Path.Combine(root, "Prosa.old.exe")); }
            catch (Exception) { /* fica pra próxima */ }

            power.Click += delegate
            {
                if (state == State.Off) Start();
                else Stop("Desligado", "Aperte Ligar pra pôr o Prosa no ar de novo.", Grey);
            };
            copy.Click += delegate
            {
                if (url == null) return;
                try
                {
                    Clipboard.SetText(url);
                    copy.Content = "Copiado!";
                    var back = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.6) };
                    back.Tick += delegate { copy.Content = "Copiar link"; back.Stop(); };
                    back.Start();
                }
                catch (Exception) { /* outro programa segurando a área de transferência: é só tentar de novo */ }
            };
            // Abre pelo link público, não por localhost: os convites que a pessoa copiar lá dentro saem
            // com o endereço da página, e um convite com "localhost" não serve pra mais ninguém.
            open.Click += delegate { OpenInBrowser(url ?? Local); };
            more.Click += delegate
            {
                bool show = log.Visibility != Visibility.Visible;
                log.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
                more.Content = show ? "Esconder detalhes" : "Mostrar detalhes";
                if (show) log.ScrollToEnd();
            };

            SourceInitialized += delegate { DarkTitleBar(); };
            Loaded += delegate { if (this.autoStart) Start(); };
            Closing += OnClosing;

            // O mesmo desenho do ícone do .exe: o .ico (com todos os tamanhos) vai pra barra de título e de
            // tarefas, e o PNG grande vira o logo no topo da janela. Os dois vêm embutidos (ver build.ps1).
            try
            {
                Icon = BitmapFrame.Create(Embedded("Prosa.icon.ico"));
                ((Image)ui.FindName("logo")).Source = BitmapFrame.Create(Embedded("Prosa.icon.png"));
            }
            catch (Exception) { /* sem o desenho embutido: a janela abre do mesmo jeito, só sem o ícone */ }
        }

        /// <summary>Um arquivo embutido no .exe, copiado pra memória (a imagem lê dele enquanto existir).</summary>
        static Stream Embedded(string name)
        {
            var copy = new MemoryStream();
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) source.CopyTo(copy);
            copy.Position = 0;
            return copy;
        }

        // ---------- ligar e desligar ----------

        async void Start()
        {
            int mine = ++round;
            url = null;
            tunnelReady = false;
            Show(State.Starting, "Ligando…", "Conferindo o que precisa.", Amber);
            try
            {
                if (!File.Exists(System.IO.Path.Combine(root, "server", "index.ts")))
                    throw new Friendly("O Prosa.exe precisa ficar dentro da pasta do projeto, ao lado das pastas server e src.");
                string node = Find("node.exe", @"C:\Program Files\nodejs\node.exe");
                if (node == null) throw new Friendly("Não achei o Node.js. Instale a versão 24 ou mais nova em nodejs.org e tente de novo.");
                string tunnelExe = Find("cloudflared.exe", @"C:\Program Files (x86)\cloudflared\cloudflared.exe", @"C:\Program Files\cloudflared\cloudflared.exe");
                if (tunnelExe == null) throw new Friendly("Não achei o cloudflared. Instale com o comando:  winget install Cloudflare.cloudflared");
                if (await PortOpen())
                    throw new Friendly("A porta 3001 já está em uso — o Prosa deve estar rodando em outro lugar (um terminal com npm start ou npm run dev). Feche lá e tente de novo.");

                OpenLog();
                if (!Directory.Exists(System.IO.Path.Combine(root, "node_modules")))
                {
                    Show(State.Starting, "Ligando…", "Instalando o que o projeto precisa. Só acontece na primeira vez e leva um minuto.", Amber);
                    if (await Run("cmd.exe", "/c npm install --no-fund --no-audit", mine) != 0) throw new Friendly("A instalação das dependências falhou. Veja os detalhes.");
                }
                if (NeedsBuild())
                {
                    Show(State.Starting, "Ligando…", "Preparando o app.", Amber);
                    if (await Run("cmd.exe", "/c npm run build", mine) != 0) throw new Friendly("Não deu pra preparar o app. Veja os detalhes.");
                }

                Show(State.Starting, "Ligando…", "Subindo o servidor.", Amber);
                var env = new Dictionary<string, string> { { "PORT", Port.ToString() }, { "HOST", "127.0.0.1" } };
                Process server = Spawn(node, "--disable-warning=ExperimentalWarning server/index.ts", "servidor", env, mine);
                for (int i = 0; !await PortOpen(); i++)
                {
                    Check(mine);
                    if (server.HasExited || i > 100) throw new Friendly("O servidor não subiu. Veja os detalhes.");
                    await Task.Delay(300);
                }

                Show(State.Starting, "Ligando…", "Abrindo o túnel e pegando o link.", Amber);
                Process tunnel = Spawn(tunnelExe, "tunnel --no-autoupdate --url http://127.0.0.1:" + Port, "túnel", null, mine);
                for (int i = 0; url == null || !tunnelReady; i++)
                {
                    Check(mine);
                    if (tunnel.HasExited || i > 150) throw new Friendly("O túnel não abriu. Confira a internet e tente de novo — às vezes o serviço gratuito da Cloudflare demora ou recusa.");
                    await Task.Delay(300);
                }

                // O endereço novo leva alguns segundos pra existir na internet. Só vale dizer "no ar" quando ele responde.
                Show(State.Starting, "Ligando…", "Esperando o link começar a responder.", Amber);
                bool answers = false;
                for (int i = 0; i < 25 && !(answers = await Reachable(url)); i++)
                {
                    Check(mine);
                    if (tunnel.HasExited) throw new Friendly("O túnel caiu logo depois de abrir. Tente de novo.");
                    await Task.Delay(1500);
                }
                Check(mine);

                link.Text = url;
                link.Foreground = Paint("#C9BFFF");
                copy.IsEnabled = open.IsEnabled = true;
                Show(State.On, "No ar", answers
                    ? "Mande o link pros amigos. Cada um cria a própria conta e entra no seu servidor pelo convite."
                    : "O link saiu, mas daqui ele ainda não respondeu. Costuma levar mais alguns segundos — teste antes de mandar.", Green);
            }
            catch (OperationCanceledException) { /* desligou no meio: quem cancelou já arrumou a tela */ }
            catch (Friendly e) { if (mine == round) Stop("Não ligou", e.Message, Red); }
            catch (Exception e)
            {
                Line("launcher", e.ToString());
                if (mine == round) Stop("Não ligou", "Deu um erro inesperado. Veja os detalhes.", Red);
            }
        }

        void Stop(string title, string text, Brush color)
        {
            round++;
            // Encerra tudo o que subiu, inclusive o Chrome do navegador da sala, que é filho do servidor.
            TerminateJobObject(job, 0);
            url = null;
            link.Text = "Aparece aqui quando o Prosa estiver no ar.";
            link.Foreground = Grey;
            copy.IsEnabled = open.IsEnabled = false;
            Show(State.Off, title, text, color);
        }

        void Check(int mine)
        {
            if (mine != round) throw new OperationCanceledException();
        }

        void Show(State next, string title, string text, Brush color)
        {
            state = next;
            status.Text = title;
            detail.Text = text;
            dot.Fill = color;

            bool busy = next == State.Starting;
            powerText.Text = next == State.Off ? "Ligar" : busy ? "Cancelar" : "Desligar";
            powerIcon.Text = next == State.Off ? "\uE7E8" : "\uE71A";
            power.Background = next == State.Off ? Accent : Panel;
            power.BorderBrush = next == State.On ? Green : Brushes.Transparent;
            halo.Fill = next == State.On ? Green : Accent;

            spinner.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
            var spin = (RotateTransform)spinner.RenderTransform;
            spin.BeginAnimation(RotateTransform.AngleProperty,
                busy ? new DoubleAnimation(0, 360, TimeSpan.FromSeconds(1.4)) { RepeatBehavior = RepeatBehavior.Forever } : null);
        }

        void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (state != State.Off)
            {
                var answer = MessageBox.Show(this, "Fechar desliga o Prosa pra todo mundo que está usando.\n\nFechar mesmo?", "Prosa",
                    MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No);
                if (answer != MessageBoxResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }
            round++;
            TerminateJobObject(job, 0);
        }

        // ---------- processos ----------

        Process Spawn(string file, string args, string name, Dictionary<string, string> env, int mine)
        {
            var info = new ProcessStartInfo(file, args)
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            if (env != null) foreach (var pair in env) info.EnvironmentVariables[pair.Key] = pair.Value;

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Line(name, e.Data); };
            process.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Line(name, e.Data); };
            process.Exited += delegate
            {
                // Servidor ou túnel que cai sozinho com o Prosa no ar derruba o resto: meio ligado não serve.
                Dispatcher.BeginInvoke(new Action(delegate
                {
                    if (mine == round && state == State.On)
                        Stop("Caiu", "O " + name + " parou sozinho. Aperte Ligar pra subir de novo (o link vai mudar).", Red);
                }));
            };
            process.Start();
            // No job, o processo (e os filhos dele) morre junto com esta janela, mesmo se ela for encerrada à força.
            AssignProcessToJobObject(job, process.Handle);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        async Task<int> Run(string file, string args, int mine)
        {
            Process process = Spawn(file, args, "preparo", null, mine);
            while (!process.HasExited)
            {
                Check(mine);
                await Task.Delay(200);
            }
            return process.ExitCode;
        }

        /// <summary>Uma linha da saída do servidor ou do túnel. Chega em outra thread.</summary>
        void Line(string source, string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            if (source == "túnel")
            {
                Match found = TunnelUrl.Match(text);
                if (found.Success && url == null) url = found.Value;
                // O endereço sai antes de o túnel estar de fato ligado; só vale mostrar depois desta linha.
                if (text.Contains("Registered tunnel connection")) tunnelReady = true;
            }
            string entry = "[" + source + "] " + text;
            lock (logLock)
            {
                if (logFile != null) logFile.WriteLine(entry);
            }
            Dispatcher.BeginInvoke(new Action(delegate
            {
                lines.Add(entry);
                if (lines.Count > 400) lines.RemoveRange(0, 100);
                if (log.Visibility == Visibility.Visible)
                {
                    log.Text = string.Join(Environment.NewLine, lines);
                    log.ScrollToEnd();
                }
                else log.Text = string.Join(Environment.NewLine, lines);
            }));
        }

        void OpenLog()
        {
            lock (logLock)
            {
                if (logFile != null) logFile.Dispose();
                string dir = System.IO.Path.Combine(root, "data");
                Directory.CreateDirectory(dir);
                logFile = new StreamWriter(System.IO.Path.Combine(dir, "launcher.log"), false, Encoding.UTF8) { AutoFlush = true };
            }
            lines.Clear();
        }

        /// <summary>O front compilado some ou fica velho quando o código muda: aí precisa refazer.</summary>
        bool NeedsBuild()
        {
            string built = System.IO.Path.Combine(root, "dist", "index.html");
            if (!File.Exists(built)) return true;
            DateTime at = File.GetLastWriteTimeUtc(built);
            foreach (string file in new[] { "index.html", "package.json", "vite.config.ts" })
                if (File.GetLastWriteTimeUtc(System.IO.Path.Combine(root, file)) > at) return true;
            foreach (string folder in new[] { "src", "shared", "public" })
            {
                string dir = System.IO.Path.Combine(root, folder);
                if (!Directory.Exists(dir)) continue;
                foreach (string file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                    if (File.GetLastWriteTimeUtc(file) > at) return true;
            }
            return false;
        }

        static async Task<bool> PortOpen()
        {
            using (var client = new TcpClient())
            {
                try
                {
                    Task connect = client.ConnectAsync("127.0.0.1", Port);
                    return await Task.WhenAny(connect, Task.Delay(400)) == connect && client.Connected;
                }
                catch (Exception) { return false; }
            }
        }

        static Task<bool> Reachable(string address)
        {
            return Task.Run(() =>
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create(address);
                    request.Timeout = 5000;
                    using (var response = (HttpWebResponse)request.GetResponse()) return response.StatusCode == HttpStatusCode.OK;
                }
                catch (Exception) { return false; }
            });
        }

        /// <summary>Procura um programa no PATH e, se não achar, nos lugares onde ele costuma ser instalado.</summary>
        static string Find(string exe, params string[] usual)
        {
            foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try
                {
                    string candidate = System.IO.Path.Combine(dir.Trim(), exe);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { /* entrada torta no PATH */ }
            }
            foreach (string candidate in usual) if (File.Exists(candidate)) return candidate;
            return null;
        }

        static void OpenInBrowser(string address)
        {
            try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
            catch (Exception) { /* sem navegador padrão configurado */ }
        }

        static Brush Paint(string hex)
        {
            var brush = (Brush)new BrushConverter().ConvertFromString(hex);
            brush.Freeze();
            return brush;
        }

        // ---------- Windows ----------

        /// <summary>Barra de título escura, na cor do fundo (Windows 11).</summary>
        void DarkTitleBar()
        {
            IntPtr window = new WindowInteropHelper(this).Handle;
            int on = 1;
            DwmSetWindowAttribute(window, 20, ref on, 4);
            int color = 0x0017100E; // #0E1017, na ordem BGR que a API pede
            DwmSetWindowAttribute(window, 35, ref color, 4);
        }

        static IntPtr CreateKillOnCloseJob()
        {
            IntPtr handle = CreateJobObject(IntPtr.Zero, null);
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(handle, 9, ref info, (uint)Marshal.SizeOf(info));
            return handle;
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }
    }
}
