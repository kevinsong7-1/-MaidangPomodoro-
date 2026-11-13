using System.Text.Json;
using System.Drawing.Drawing2D;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MaidangPomodoro;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TimerWindow());
    }
}

internal sealed class TimerWindow : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private bool expanded = true;
    private Point? panelLocation;

    public TimerWindow()
    {
        Text = "麦当番茄钟";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        ClientSize = new Size(390, 720);
        Controls.Add(browser);
        Shown += async (_, _) => await InitializeBrowser();
    }

    private async Task InitializeBrowser()
    {
        try
        {
            var dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaidangPomodoro", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataPath);
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            browser.CoreWebView2.WebMessageReceived += OnWebMessage;
            browser.CoreWebView2.SetVirtualHostNameToFolderMapping("maidang.local", Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
            browser.Source = new Uri("https://maidang.local/widget.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show("无法启动界面，请确认已安装 Microsoft Edge WebView2 Runtime。\n\n" + ex.Message, "麦当番茄钟", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            if (!message.RootElement.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "ready": SendView(); break;
                case "expand": SetView(true); break;
                case "collapse": SetView(false); break;
                case "close": Close(); break;
                case "finished": System.Media.SystemSounds.Asterisk.Play(); break;
            }
        }
        catch (JsonException) { }
    }

    private void SetView(bool showPanel)
    {
        var area = Screen.FromControl(this).WorkingArea;
        if (!showPanel && expanded) panelLocation = Location;
        expanded = showPanel;
        FormBorderStyle = showPanel ? FormBorderStyle.FixedSingle : FormBorderStyle.None;
        ClientSize = showPanel ? new Size(390, 720) : new Size(260, 74);
        TopMost = !showPanel;
        var position = showPanel ? panelLocation ?? Location : new Point(area.Right - Width - 12, area.Bottom - Height - 12);
        Location = new Point(Math.Clamp(position.X, area.Left, Math.Max(area.Left, area.Right - Width)), Math.Clamp(position.Y, area.Top, Math.Max(area.Top, area.Bottom - Height)));
        var previousRegion = Region;
        if (showPanel) Region = null;
        else
        {
            using var shape = new GraphicsPath();
            int diameter = Math.Min(ClientSize.Height, ClientSize.Width);
            shape.AddArc(0, 0, diameter, diameter, 90, 180);
            shape.AddArc(ClientSize.Width - diameter, 0, diameter, diameter, 270, 180);
            shape.CloseFigure();
            Region = new Region(shape);
        }
        previousRegion?.Dispose();
        SendView();
    }

    protected override void WndProc(ref Message m)
    {
        const int wmSysCommand = 0x0112;
        const int scMinimize = 0xF020;
        if (m.Msg == wmSysCommand && ((long)m.WParam & 0xFFF0) == scMinimize)
        {
            SetView(false);
            return;
        }
        base.WndProc(ref m);
    }

    private void SendView() => browser.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "view", value = expanded ? "panel" : "pill" }));
}
