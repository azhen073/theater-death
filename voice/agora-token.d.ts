/**
 * `agora-token` 官方 npm 包未附带类型声明且为 CommonJS 模块，
 * 这里声明本项目用到的最小 API 表面（default 导入以兼容 Node 原生 ESM）。
 * 参考声网文档：使用 Token 鉴权（BuildTokenWithUid / BuildTokenWithUidAndPrivilege）。
 */
declare module 'agora-token' {
  interface RtcTokenBuilderApi {
    /** 生成 AccessToken2，并统一设置 Token 与所有权限的过期时长（秒） */
    buildTokenWithUid(
      appId: string,
      appCertificate: string,
      channelName: string,
      uid: number,
      role: number,
      tokenExpirationInSeconds: number,
      privilegeExpirationInSeconds: number,
    ): string;
    /** 生成 AccessToken2，并分别设置加入频道、发布音频/视频/数据流权限的过期时长（秒） */
    buildTokenWithUidAndPrivilege(
      appId: string,
      appCertificate: string,
      channelName: string,
      uid: number,
      tokenExpirationInSeconds: number,
      joinChannelPrivilegeExpireInSeconds: number,
      pubAudioPrivilegeExpireInSeconds: number,
      pubVideoPrivilegeExpireInSeconds: number,
      pubDataStreamPrivilegeExpireInSeconds: number,
    ): string;
  }

  interface AgoraTokenModule {
    readonly RtcTokenBuilder: RtcTokenBuilderApi;
    readonly RtcRole: {
      readonly PUBLISHER: number;
      readonly SUBSCRIBER: number;
    };
  }

  const agoraToken: AgoraTokenModule;
  export default agoraToken;
}
