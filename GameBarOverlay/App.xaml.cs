using System;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Microsoft.Gaming.XboxGameBar;

namespace GameBarOverlay
{
    public sealed partial class App : Application
    {
        private XboxGameBarWidget widget;

        public App()
        {
            Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00FFFFFF");
            InitializeComponent();
            Suspending += OnSuspending;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            if (e.PrelaunchActivated)
            {
                return;
            }

            var rootFrame = EnsureRootFrame();
            if (rootFrame.Content == null)
            {
                rootFrame.Navigate(typeof(MainPage));
            }

            Window.Current.Activate();
        }

        protected override void OnActivated(IActivatedEventArgs e)
        {
            XboxGameBarWidgetActivatedEventArgs widgetArgs = null;
            if (e.Kind == ActivationKind.Protocol)
            {
                var protocolArgs = e as IProtocolActivatedEventArgs;
                if (
                    protocolArgs != null
                    && protocolArgs.Uri != null
                    && string.Equals(
                        protocolArgs.Uri.Scheme,
                        "ms-gamebarwidget",
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                {
                    widgetArgs = e as XboxGameBarWidgetActivatedEventArgs;
                }
            }

            if (widgetArgs == null)
            {
                base.OnActivated(e);
                return;
            }

            NavigateToWidgetShell(widgetArgs);
        }

        private void NavigateToWidgetShell(XboxGameBarWidgetActivatedEventArgs widgetArgs)
        {
            var rootFrame = EnsureRootFrame();
            if (widgetArgs.IsLaunchActivation || widget == null)
            {
                widget = new XboxGameBarWidget(widgetArgs, Window.Current.CoreWindow, rootFrame);
                Window.Current.Closed -= OnWidgetWindowClosed;
                Window.Current.Closed += OnWidgetWindowClosed;
            }

            var page = rootFrame.Content as MainPage;
            if (page == null)
            {
                rootFrame.Navigate(typeof(MainPage), widget);
            }
            else
            {
                page.AttachWidget(widget);
            }

            page = rootFrame.Content as MainPage;
            if (page != null)
            {
                page.HandleActivation();
            }

            Window.Current.Activate();
        }

        private Frame EnsureRootFrame()
        {
            if (Window.Current.Content is Frame rootFrame)
            {
                return rootFrame;
            }

            rootFrame = new Frame();
            rootFrame.NavigationFailed += OnNavigationFailed;
            Window.Current.Content = rootFrame;
            return rootFrame;
        }

        private void OnWidgetWindowClosed(object sender, Windows.UI.Core.CoreWindowEventArgs e)
        {
            widget = null;
            Window.Current.Closed -= OnWidgetWindowClosed;
        }

        private void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            throw new Exception($"Failed to load page '{e.SourcePageType.FullName}'.");
        }

        private void OnSuspending(object sender, SuspendingEventArgs e)
        {
            var deferral = e.SuspendingOperation.GetDeferral();
            widget = null;
            deferral.Complete();
        }
    }
}
