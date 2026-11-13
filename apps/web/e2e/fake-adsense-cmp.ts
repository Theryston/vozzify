import type { IncomingMessage, ServerResponse } from 'node:http';

/** The default e2e consent is unresolved/denied, so it never sends an ad request. */
export function serveFakeAdsenseCmp(
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.writeHead(200, {
    'content-type': 'text/javascript',
    'access-control-allow-origin': '*',
  });
  response.end(
    'window.__tcfapi=function(command,version,callback){' +
      "if(command==='addEventListener'){callback({" +
      "listenerId:1,eventStatus:'tcloaded',gdprApplies:true," +
      'purpose:{consents:{}},vendor:{consents:{}}},true)}' +
      "if(command==='removeEventListener'){callback(true,true)}}",
  );
  return Promise.resolve();
}
