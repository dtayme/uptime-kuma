import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Compile: javac index.java
 * Run: java Index
 */
class Index {

    public static final String PUSH_URL = "https://example.com/api/push";
    public static final String PUSH_TOKEN = "your-token";
    public static final int INTERVAL = 60;

    public static void main(String[] args) {
        while (true) {
            try {
                URL url = new URL(PUSH_URL);
                HttpURLConnection con = (HttpURLConnection) url.openConnection();
                con.setRequestMethod("POST");
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                con.setRequestProperty("X-Push-Token", PUSH_TOKEN);
                byte[] payload = "status=up&msg=OK&ping=".getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = con.getOutputStream()) {
                    os.write(payload);
                }
                con.getResponseCode();
                con.disconnect();
                System.out.println("Pushed!");
            } catch (Exception e) {
                e.printStackTrace();
            }
            try {
                Thread.sleep(INTERVAL * 1000);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }
}
