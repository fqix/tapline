# ReqBin cURL 导入测试覆盖

来源：[ReqBin cURL](https://reqbin.com/curl)，采集日期：2026-09-22。

## 范围与结果

- 首页 Examples 列表的 **48/48 个入口**均有主 demo 导入测试。
- 同时检查这些页面正文的 cURL 代码块；页内完全相同的命令去重，保留跨页面重复以追踪来源。
- 共记录 272 段：157 段具体请求验证导入结果；1 段引号未闭合的原站示例验证报错；114 段不可直接运行的内容记录排除原因。
- 排除项包括 110 段 URL 占位语法、无 URL 的片段、help/version 或输出，3 段被站点遮蔽的邮箱/文件值，以及 1 段未加引号的 `[POST data]` 语法占位符。它们不计为导入成功。
- 9 个数据文件示例各验证缺失文件提示与提供模拟文件后的正文，共 168 个语料测试（含 1 个清单完整性检查）。

验证对象是 `importCurl` 生成的 method、URL、请求头、正文和警告，不向 ReqBin 或其他公网地址发送示例请求。预期值固定在 JSON 中，测试运行时不调用解析器生成预期结果。

## 已发现并修复

- 无反斜杠续行的选项和独占一行的 HTTP(S) URL 均能导入，保留引号中的正文换行。
- `-H "User-Agent:"` 删除请求头后，不再导入生成器额外补入的 User-Agent；只有原请求指定的 User-Agent 才写入草稿。
- multipart 文件仅有路径占位内容时增加明确警告，不能静默当成已加载的文件。

## 支持边界

- 文件正文通过模拟 FileReader 验证；没有实际读取开发者机器上的示例文件。
- multipart 文件内容尚未导入；测试验证字段、文件路径、边界及警告。
- 代理、客户端证书、自签名 CA、Cookie 文件、限速、部分连接/重定向选项无法映射到当前草稿，测试要求保留相应警告。
- 多 URL 或多条 curl 命令只导入第一条，测试同时检查警告。
- `-k`、超时、下载输出路径等当前被忽略的选项只验证请求字段导入，不代表实际发送时复现这些传输/文件行为。
- 原站 User-Agent 页有一条末尾多出双引号的命令；保留原文并验证拒绝，不修饰原文后冒充通过。

## 逐页清单

| 示例来源 | 主 demo | 具体请求 | 错误输入 | 排除片段 |
|---|---|---:|---:|---:|
| [How do I send a GET request using Curl?](https://reqbin.com/req/c-1n4ljxb9/curl-get-request-example) | 已测试 | 9 | 0 | 0 |
| [How do I send a Curl request with a bearer token authorization header?](https://reqbin.com/req/c-hlt4gkzd/curl-bearer-token-authorization-header-example) | 已测试 | 4 | 0 | 0 |
| [How do I download a file using Curl?](https://reqbin.com/req/c-egazzayq/curl-download-file) | 已测试 | 2 | 0 | 6 |
| [How to post JSON using Curl?](https://reqbin.com/req/c-dwjszac0/curl-post-json-example) | 已测试 | 5 | 0 | 1 |
| [How do I post request body with Curl?](https://reqbin.com/req/c-d2nzjn3z/curl-post-body) | 已测试 | 7 | 0 | 0 |
| [How do I send Basic Auth Credentials with Curl?](https://reqbin.com/req/c-haxm0xgr/curl-basic-auth-example) | 已测试 | 2 | 0 | 1 |
| [How do I post a request using Curl?](https://reqbin.com/req/c-g5d14cew/curl-post-example) | 已测试 | 8 | 0 | 1 |
| [How do I post form data using Curl?](https://reqbin.com/req/c-sma2qrvp/curl-post-form-example) | 已测试 | 2 | 0 | 4 |
| [How do I post a file using Curl?](https://reqbin.com/req/c-dot4w5a2/curl-post-file) | 已测试 | 4 | 0 | 2 |
| [How do I get JSON with Curl?](https://reqbin.com/req/c-vdhoummp/curl-get-json-example) | 已测试 | 3 | 0 | 1 |
| [How do I make HTTPS requests with Curl?](https://reqbin.com/req/c-lfozgltr/curl-https-request) | 已测试 | 4 | 0 | 0 |
| [20 Most Popular Curl Flags](https://reqbin.com/req/c-skhwmiil/curl-flags-example) | 已测试 | 1 | 0 | 23 |
| [How to send PUT request using Curl?](https://reqbin.com/req/c-d4os3720/curl-put-example) | 已测试 | 6 | 0 | 2 |
| [How do I send Cookies with Curl?](https://reqbin.com/req/c-bjcj04uw/curl-send-cookies-example) | 已测试 | 3 | 0 | 3 |
| [How do I convert Curl to HTTP Request?](https://reqbin.com/req/c-w7oitglz/convert-curl-to-http-request) | 已测试 | 1 | 0 | 1 |
| [How do I use Curl with SSL connections?](https://reqbin.com/req/c-bw1fsypn/curl-ssl-request) | 已测试 | 5 | 0 | 1 |
| [How to follow redirects using Curl?](https://reqbin.com/req/c-bvijc9he/curl-follow-redirect) | 已测试 | 3 | 0 | 5 |
| [How do I send a HEAD request using Curl?](https://reqbin.com/req/c-tmyvmbgu/curl-head-request-example) | 已测试 | 2 | 0 | 2 |
| [How to send HTTP header with Curl request?](https://reqbin.com/req/c-ea0d5rlb/curl-send-header-example) | 已测试 | 7 | 0 | 2 |
| [How do I post XML using Curl?](https://reqbin.com/req/c-yzrfjhug/curl-post-xml-example) | 已测试 | 2 | 0 | 0 |
| [How to send a Curl request with username and password?](https://reqbin.com/req/c-fkj7kdqi/curl-request-with-credentials) | 已测试 | 2 | 0 | 2 |
| [How to set the User-Agent string in Curl?](https://reqbin.com/req/c-ekublyqq/curl-user-agent) | 已测试 | 2 | 1 | 2 |
| [Top 12 Curl Commands](https://reqbin.com/req/c-kdnocjul/curl-commands) | 已测试 | 11 | 0 | 2 |
| [How do I set the content type for a Curl request?](https://reqbin.com/req/c-woh4qwov/curl-content-type) | 已测试 | 4 | 0 | 1 |
| [How do I get XML using Curl?](https://reqbin.com/req/c-eanbjsr1/curl-get-xml-example) | 已测试 | 2 | 0 | 2 |
| [How do I use curl -k option?](https://reqbin.com/req/c-vq73orsy/curl--k) | 已测试 | 4 | 0 | 1 |
| [How do I use curl -u option?](https://reqbin.com/req/c-qjaws1fh/curl--u) | 已测试 | 1 | 0 | 1 |
| [How do I use curl -d option?](https://reqbin.com/req/c-bf0dgjoq/curl--d) | 已测试 | 2 | 0 | 1 |
| [How can I send a CORS request using Curl?](https://reqbin.com/req/c-taimahsa/curl-cors-request) | 已测试 | 4 | 0 | 1 |
| [Howto make POST request with basic authentication credentials using Curl?](https://reqbin.com/req/c-2cd3jxee/curl-post-with-basic-authentication-example) | 已测试 | 1 | 0 | 3 |
| [How do I run Curl on Windows?](https://reqbin.com/req/c-g95rmxs0/curl-for-windows) | 已测试 | 1 | 0 | 0 |
| [How to set a timeout for a Curl request?](https://reqbin.com/req/c-70cqyayb/curl-timeout) | 已测试 | 6 | 0 | 2 |
| [How do I send a DELETE request using Curl?](https://reqbin.com/req/c-1dw4uds4/curl-delete-request-example) | 已测试 | 2 | 0 | 1 |
| [How do I use Curl with a proxy?](https://reqbin.com/req/c-ddxflki5/curl-proxy-server) | 已测试 | 2 | 0 | 5 |
| [The most popular Curl examples](https://reqbin.com/req/c-s3bfyrby/curl-examples) | 已测试 | 2 | 0 | 12 |
| [How do I send OPTIONS request using Curl?](https://reqbin.com/req/c-d8nxa0fl/curl-options-request) | 已测试 | 2 | 0 | 1 |
| [How to send a PATCH request using Curl?](https://reqbin.com/req/c-90t7l4bk/curl-patch-request) | 已测试 | 7 | 0 | 1 |
| [How do I send JSON data using Curl?](https://reqbin.com/req/c-fypvcnti/curl-json-request-example) | 已测试 | 2 | 0 | 0 |
| [How to ignore invalid and self-signed SSL certificate errors in Curl?](https://reqbin.com/req/c-ug1qqqwh/curl-ignore-certificate-checks) | 已测试 | 2 | 0 | 1 |
| [How to force Curl to close the connection after response?](https://reqbin.com/req/c-ulfpjfcv/curl-command-with-close-connection-header) | 已测试 | 1 | 0 | 1 |
| [How to use Curl?](https://reqbin.com/req/c-r8g2qivg/how-to-use-curl) | 已测试 | 1 | 0 | 17 |
| [How to send No-Cache request with Curl?](https://reqbin.com/req/c-dyugjcgf/curl-no-cache-example) | 已测试 | 3 | 0 | 0 |
| [How to convert Curl to Python request?](https://reqbin.com/req/python/c-xgafmluu/convert-curl-to-python-requests) | 已测试 | 2 | 0 | 0 |
| [Wget vs Curl: What's the Difference?](https://reqbin.com/req/c-ojpjkl15/wget-vs-curl) | 已测试 | 3 | 0 | 1 |
| [How to pass custom headers to Curl?](https://reqbin.com/req/c-tm07oqh4/curl-custom-headers) | 已测试 | 2 | 0 | 0 |
| [How to send Curl keep-alive request?](https://reqbin.com/req/c-jjwwaevv/curl-command-with-keep-alive-connection-header) | 已测试 | 2 | 0 | 1 |
| [How do I convert a Curl command into a JavaScript/AJAX?](https://reqbin.com/req/javascript/c-wyuctivp/convert-curl-to-javascript) | 已测试 | 2 | 0 | 0 |
| [How do I convert Curl Commands to PHP code?](https://reqbin.com/req/php/c-kvv2ga1h/convert-curl-to-php) | 已测试 | 2 | 0 | 0 |

## 复现

```sh
npm test -- src/test/utils/curlReqbin.test.ts src/test/utils/curl.test.ts
npm run typecheck
npm run build
npm test
```

测试代码：`src/test/utils/curlReqbin.test.ts`；来源、原命令、固定预期及排除原因：`src/test/fixtures/reqbin-curl.json`。
