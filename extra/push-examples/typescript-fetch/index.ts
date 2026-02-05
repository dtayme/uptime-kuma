// Supports: Deno, Bun, Node.js >= 18 (ts-node)
const pushURL: string = "https://example.com/api/push";
const pushToken: string = "your-token";
const interval: number = 60;

const push = async () => {
    await fetch(pushURL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Push-Token": pushToken,
        },
        body: JSON.stringify({
            status: "up",
            msg: "OK",
            ping: "",
        }),
    });
    console.log("Pushed!");
};

push();
setInterval(push, interval * 1000);
