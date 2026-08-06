import { useEffect, useRef, useCallback, useState } from 'react';

interface WebSocketMessage {
  type: string;
  payload: any;
}

// 计算WebSocket服务器地址，按优先级：
// 1. NEXT_PUBLIC_WS_URL 环境变量：完全自定义地址，优先级最高
// 2. NEXT_PUBLIC_WS_PATH_MODE=true：走"同域同端口 + /ws 路径"模式——
//    适合 Cloudflare Tunnel / Nginx反代 这类"只暴露一个端口给公网"的场景，
//    因为隧道通常只能把一个hostname指向一个源端口，没法再单独开一个端口给WebSocket。
//    此时不再拼9998端口，而是用当前页面的协议+主机名（不带端口，跟着80/443走），
//    加上 /ws 路径前缀，由nginx按路径把请求转发到WebSocket服务（见 nginx.conf 的 location /ws）。
// 3. 默认：局域网/直连场景，自动取当前hostname拼WS端口（不经过反代，直接连WebSocket进程）
export function getWsUrl(port: number = 9998): string {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl) return envUrl;

  if (typeof window === 'undefined') return `ws://localhost:${port}`;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (process.env.NEXT_PUBLIC_WS_PATH_MODE === 'true') {
    // 不带端口：交给80/443端口上的nginx按路径反代，适配Cloudflare Tunnel等只转发单端口的场景
    return `${protocol}//${window.location.host}/ws`;
  }

  return `${protocol}//${window.location.hostname}:${port}`;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef<number>(0); // 重连次数
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const optionsRef = useRef(options);
  
  // 更新options ref
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback(() => {
    if (!url) {
      console.log('⚠️ WebSocket URL为空，跳过连接');
      return;
    }

    console.log('🔗 尝试连接WebSocket:', url);

    try {
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('✅ WebSocket连接成功');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // 重置重连计数
        optionsRef.current.onOpen?.();
        
        // 启动心跳
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 30000); // 每30秒心跳
        
        ws.addEventListener('close', () => clearInterval(heartbeat));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          optionsRef.current.onMessage?.(message);
        } catch (error) {
          console.error('❌ 消息解析失败:', error);
        }
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket连接关闭');
        setIsConnected(false);
        optionsRef.current.onClose?.();
        
        // 不自动重连，避免无限循环
        console.log('⚠️ WebSocket已关闭，请刷新页面重新连接');
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket错误:', error);
        console.error('❌ WebSocket详细信息:', {
          url,
          readyState: ws?.readyState,
          type: error?.type,
          target: error?.target,
        });
        
        // 检查是否是连接失败
        if (ws?.readyState === WebSocket.CLOSED || ws?.readyState === WebSocket.CLOSING) {
          console.error('❌ WebSocket连接失败，可能原因：');
          console.error('   1. WebSocket服务器未运行（检查: node server/websocket-server.js）');
          console.error('   2. 端口不正确（当前尝试: ' + url + '）');
          console.error('   3. 防火墙阻止连接');
        }
        
        optionsRef.current.onError?.(error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('❌ WebSocket连接失败:', error);
    }
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('⚠️ WebSocket未连接，消息未发送');
    }
  }, []);

  useEffect(() => {
    if (url) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url]); // 只依赖url，移除connect和disconnect

  return {
    isConnected,
    lastMessage,
    sendMessage,
    disconnect,
  };
}
