using System;
using System.Collections.Specialized;
using System.Net;
using System.Threading;

/**
 * Compile: C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe index.cs
 * Run: index.exe
 */
class Index
{
    const string PushURL  = "https://example.com/api/push";
    const string PushToken = "your-token";
    const int Interval = 60;

    static void Main(string[] args)
    {
        while (true)
        {
            WebClient client = new WebClient();
            client.Headers.Add("X-Push-Token", PushToken);
            client.UploadValues(PushURL, "POST", new NameValueCollection {
                { "status", "up" },
                { "msg", "OK" },
                { "ping", "" },
            });
            Console.WriteLine("Pushed!");
            Thread.Sleep(Interval * 1000);
        }
    }
}
