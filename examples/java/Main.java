import java.io.FileInputStream;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * Java HTTP Client Examples (GET, POST, DELETE)
 *
 * Uses Java 11+ standard java.net.http.HttpClient (zero external dependencies).
 * Automatically reads HTTP_PROXY / HTTPS_PROXY and SSL_CERT_FILE.
 * Supports single-file execution:
 *   java examples/java/Main.java
 */
public class Main {

    private static String getBaseUrl() {
        String env = System.getenv("HTTPBIN");
        if (env != null && !env.isBlank()) return env;
        env = System.getenv("BASE_URL");
        if (env != null && !env.isBlank()) return env;
        return "https://httpbin.org";
    }

    private static ProxySelector createProxySelector() {
        String proxyEnv = System.getenv("HTTPS_PROXY");
        if (proxyEnv == null || proxyEnv.isBlank()) {
            proxyEnv = System.getenv("https_proxy");
        }
        if (proxyEnv == null || proxyEnv.isBlank()) {
            proxyEnv = System.getenv("HTTP_PROXY");
        }
        if (proxyEnv == null || proxyEnv.isBlank()) {
            proxyEnv = System.getenv("http_proxy");
        }
        if (proxyEnv != null && !proxyEnv.isBlank()) {
            try {
                URI proxyUri = URI.create(proxyEnv.contains("://") ? proxyEnv : "http://" + proxyEnv);
                String host = proxyUri.getHost();
                int port = proxyUri.getPort() != -1 ? proxyUri.getPort() : 80;
                if (host != null && !host.isBlank()) {
                    return ProxySelector.of(new InetSocketAddress(host, port));
                }
            } catch (Exception e) {
                System.err.println("Warning: failed to parse proxy env: " + e.getMessage());
            }
        }
        return ProxySelector.getDefault();
    }

    private static SSLContext createSSLContext() {
        String caPath = System.getenv("SSL_CERT_FILE");
        if (caPath == null || caPath.isBlank()) {
            return null;
        }
        try {
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            X509Certificate caCert;
            try (FileInputStream fis = new FileInputStream(caPath)) {
                caCert = (X509Certificate) cf.generateCertificate(fis);
            }
            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            ks.setCertificateEntry("tapline-ca", caCert);

            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ks);

            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, tmf.getTrustManagers(), null);
            return sslContext;
        } catch (Exception e) {
            System.err.println("Warning: failed to load SSL_CERT_FILE: " + e.getMessage());
            return null;
        }
    }

    private static HttpClient createHttpClient() {
        HttpClient.Builder builder = HttpClient.newBuilder()
            .proxy(createProxySelector())
            .connectTimeout(Duration.ofSeconds(15));

        SSLContext sslContext = createSSLContext();
        if (sslContext != null) {
            builder.sslContext(sslContext);
        }
        return builder.build();
    }

    private static void printSnippet(String body) {
        if (body.length() > 200) {
            System.out.println("    Body: " + body.substring(0, 200) + "...");
        } else {
            System.out.println("    Body: " + body);
        }
    }

    private static void runGet(HttpClient client, String baseUrl) {
        String url = baseUrl + "/get?lang=java&sample=tapline";
        System.out.println("--> GET " + url);
        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("User-Agent", "tapline-java-example/1.0")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .GET()
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            System.out.printf("<-- %d (%d bytes)%n", response.statusCode(), response.body().length());
            printSnippet(response.body());
        } catch (Exception e) {
            System.err.println("GET failed: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
        }
        System.out.println();
    }

    private static void runPost(HttpClient client, String baseUrl) {
        String url = baseUrl + "/post";
        String payload = String.format("{\"client\":\"tapline-java\",\"action\":\"create\",\"timestamp\":\"%s\"}", Instant.now());
        System.out.printf("--> POST %s (json body: %s)%n", url, payload);
        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("User-Agent", "tapline-java-example/1.0")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            System.out.printf("<-- %d (%d bytes)%n", response.statusCode(), response.body().length());
            printSnippet(response.body());
        } catch (Exception e) {
            System.err.println("POST failed: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
        }
        System.out.println();
    }

    private static void runDelete(HttpClient client, String baseUrl) {
        String url = baseUrl + "/delete?id=42";
        System.out.println("--> DELETE " + url);
        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("User-Agent", "tapline-java-example/1.0")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .DELETE()
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            System.out.printf("<-- %d (%d bytes)%n", response.statusCode(), response.body().length());
            printSnippet(response.body());
        } catch (Exception e) {
            System.err.println("DELETE failed: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
        }
        System.out.println();
    }

    public static void main(String[] args) {
        String baseUrl = getBaseUrl();
        HttpClient client = createHttpClient();

        System.out.printf("=== Running Java HTTP Client Examples (Base: %s) ===%n%n", baseUrl);

        runGet(client, baseUrl);
        runPost(client, baseUrl);
        runDelete(client, baseUrl);

        System.out.println("=== Finished Java HTTP Client Examples ===");
    }
}
