# Basic workflow recording / 基本操作录屏

`tapline-walkthrough.gif` and `tapline-walkthrough.mp4` are exports of a real recording of Tapline in VS Code, captured and
exported with Recordly. Recordly provides focused zooms, cursor effects and a framed background; playback is sped up and idle time is cut. Requests use the public httpbin and
grpcbin services; availability and responses may vary.

GIF 与 MP4 均使用 Recordly 实际录制并导出，经过加速处理。
演示使用公开的 httpbin 和 grpcbin 服务，服务可用性和返回内容可能变化。

## Certificate setup / 证书安装

The recording starts with **Install Root Certificate**, followed by **Trust Root
Certificate** and macOS authorization. Password entry is outside the recorded
window, and the recording pauses while authorization is completed. Start capture
after the certificate is trusted.

录屏从安装根证书开始，再执行信任根证书和 macOS 授权。密码输入不在录制窗口内，
等待授权期间暂停录制；证书受信任后开始抓包。

## HTTP

Start capture, open the request composer, and send:

```http
GET https://httpbin.org/get?demo=tapline
```

Inspect the request parameters and JSON response. Choose **Edit & Resend**, change
the URL to the following, send it, then choose **Compare with Original Request**:

```http
GET https://httpbin.org/get?demo=tapline&version=2
```

## gRPC

Install `grpcurl`, and download the service's
[grpcbin.proto](https://github.com/moul/pb/blob/master/grpcbin/grpcbin.proto)
into the workspace. Tapline's default `tapline.grpc.protoFiles` setting discovers
`**/*.proto` to decode captured messages.

With SSL interception enabled, start capture and open **New Captured Terminal →
Generic**. From the folder containing `grpcbin.proto`, run:

```sh
grpcurl -cacert "$SSL_CERT_FILE" -proto grpcbin.proto \
  -d '{"fString":"Hello Tapline","fInt32":42,"fBool":true,"fStrings":["HTTP","gRPC"]}' \
  grpcb.in:443 grpcbin.GRPCBin/DummyUnary
```

The captured terminal supplies the proxy and certificate environment variables.
Select the gRPC request and open **Response → Messages** to inspect the decoded
response. Search for `Hello`, then filter the traffic list with `proto:grpc`.
Clear the filter and stop capture when finished.

Service documentation: [httpbin](https://httpbin.org/),
[grpcbin](https://github.com/moul/grpcbin).

## Field decoding / 字段解析

The recording shows the `DummyMessage` schema and both the request
and response rendered with `f_string: "Hello Tapline"`, `f_strings: ["HTTP", "gRPC"]`,
`f_int32: 42` and `f_bool: true`.
Only populated protobuf fields are present in this example.

If field names are missing, ensure `grpcbin.proto` is in the **opened VS Code
workspace**, that `tapline.grpc.protoFiles` matches it, and that the service,
method and message definitions match the captured call. Passing `-proto` to
`grpcurl` alone configures the client; Tapline also needs to discover that schema.
Choose **Messages** rather than Text or Hex in the body viewer.

录屏展示 `DummyMessage` 定义，以及请求和响应中的 `f_string`、`f_strings`、`f_int32`、`f_bool`。
示例发送这四个字段，未赋值字段不会凭空出现在消息中。
若看不到字段名，请确认 `.proto` 位于 VS Code 当前打开的工作区、匹配
`tapline.grpc.protoFiles`，且服务、方法与消息定义与请求一致。
`grpcurl -proto` 只配置客户端，Tapline 也需要能找到同一份 schema；正文视图应选择 **Messages**。
