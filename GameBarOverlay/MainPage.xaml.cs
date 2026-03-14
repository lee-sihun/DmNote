using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Gaming.XboxGameBar;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;
using Windows.Data.Json;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Windows.Web.Http;

namespace GameBarOverlay
{
    public sealed partial class MainPage : Page
    {
        private const ushort DefaultBridgePort = 34891;
        private const int BridgePortScanCount = 10;

        private readonly DispatcherTimer reconnectTimer = new DispatcherTimer();
        private readonly HttpClient httpClient = new HttpClient();

        private bool connected;
        private bool isConnecting;
        private bool disposed;
        private XboxGameBarWidget widget;

        public MainPage()
        {
            InitializeComponent();

            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
            OverlayWebView.NavigationCompleted += OnNavigationCompleted;

            reconnectTimer.Interval = TimeSpan.FromSeconds(5);
            reconnectTimer.Tick += OnReconnectTick;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            AttachWidget(e.Parameter as XboxGameBarWidget);
        }

        public void AttachWidget(XboxGameBarWidget gameBarWidget)
        {
            if (object.ReferenceEquals(widget, gameBarWidget))
            {
                return;
            }

            DetachWidget();
            widget = gameBarWidget;
            if (widget == null)
            {
                ApplyWidgetState();
                return;
            }

            widget.MinWindowSize = new Size(360, 220);
            widget.MaxWindowSize = new Size(1920, 1080);
            widget.PinningSupported = true;
            widget.SettingsSupported = false;
            widget.VerticalResizeSupported = true;
            widget.RequestedThemeChanged += OnWidgetAppearanceChanged;
            widget.RequestedOpacityChanged += OnWidgetAppearanceChanged;
            widget.WindowStateChanged += OnWidgetWindowStateChanged;
            ApplyWidgetState();
        }

        public void HandleActivation()
        {
            _ = EnsureBridgeConnectedAsync();
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            reconnectTimer.Start();
            await EnsureBridgeConnectedAsync();
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            reconnectTimer.Stop();
            OverlayWebView.NavigationCompleted -= OnNavigationCompleted;
            OverlayWebView.Close();
            httpClient.Dispose();
            DetachWidget();
        }

        private async void OnReconnectTick(object sender, object e)
        {
            if (!connected)
            {
                await EnsureBridgeConnectedAsync();
            }
        }

        private async Task EnsureBridgeConnectedAsync()
        {
            if (disposed || connected || isConnecting)
            {
                return;
            }

            isConnecting = true;
            connected = false;
            StatusPanel.Visibility = Visibility.Visible;
            StatusText.Text = "로컬 브리지를 탐색하는 중";

            try
            {
                var bootstrap = await FindBootstrapAsync();
                if (bootstrap == null)
                {
                    connected = false;
                    StatusText.Text =
                        "DmNote OBS 브리지를 찾지 못했습니다. Tauri 앱에서 OBS 모드를 먼저 시작하세요.";
                    return;
                }

                await OverlayWebView.EnsureCoreWebView2Async();
                OverlayWebView.Source = new Uri(bootstrap.Url);
                StatusText.Text = "브리지에 연결했습니다. 오버레이를 로드하는 중";
            }
            catch (Exception ex)
            {
                connected = false;
                StatusText.Text = $"브리지 연결 실패: {ex.Message}";
            }
            finally
            {
                isConnecting = false;
            }
        }

        private void ApplyWidgetState()
        {
            if (widget == null)
            {
                RequestedTheme = ElementTheme.Default;
                RootGrid.Opacity = 1.0;
                return;
            }

            RequestedTheme = widget.RequestedTheme;
            RootGrid.Opacity = Math.Max(0.2, widget.RequestedOpacity);
        }

        private void DetachWidget()
        {
            if (widget == null)
            {
                return;
            }

            widget.RequestedThemeChanged -= OnWidgetAppearanceChanged;
            widget.RequestedOpacityChanged -= OnWidgetAppearanceChanged;
            widget.WindowStateChanged -= OnWidgetWindowStateChanged;
            widget = null;
        }

        private void OnWidgetAppearanceChanged(XboxGameBarWidget sender, object args)
        {
            ApplyWidgetState();
        }

        private void OnWidgetWindowStateChanged(XboxGameBarWidget sender, object args)
        {
            ApplyWidgetState();
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            connected = e.IsSuccess;
            if (connected)
            {
                StatusPanel.Visibility = Visibility.Collapsed;
                return;
            }

            StatusPanel.Visibility = Visibility.Visible;
            StatusText.Text = $"오버레이 로드 실패: {e.WebErrorStatus}";
        }

        private async Task<GameBarBootstrap> FindBootstrapAsync()
        {
            for (var port = DefaultBridgePort; port < DefaultBridgePort + BridgePortScanCount; port++)
            {
                var bootstrap = await TryGetBootstrapAsync(port);
                if (bootstrap != null)
                {
                    return bootstrap;
                }
            }

            return null;
        }

        private async Task<GameBarBootstrap> TryGetBootstrapAsync(int port)
        {
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1)))
            {
                try
                {
                    var response = await httpClient
                        .GetAsync(new Uri($"http://127.0.0.1:{port}/gamebar/bootstrap.json"))
                        .AsTask(cts.Token);
                    if (!response.IsSuccessStatusCode)
                    {
                        return null;
                    }

                    var json = await response.Content.ReadAsStringAsync().AsTask(cts.Token);
                    var obj = JsonObject.Parse(json);
                    IJsonValue urlValue;
                    if (!obj.TryGetValue("url", out urlValue))
                    {
                        return null;
                    }

                    return new GameBarBootstrap(urlValue.GetString());
                }
                catch
                {
                    return null;
                }
            }
        }

        private sealed class GameBarBootstrap
        {
            public GameBarBootstrap(string url)
            {
                Url = url;
            }

            public string Url { get; }
        }
    }
}
