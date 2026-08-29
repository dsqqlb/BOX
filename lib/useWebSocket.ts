import { useEffect, useRef, useCallback, useState } from 'react';

interface WebSocketMessage {
  type: string;
  payload: any;
}

// WebSocket地址：默认连"当前页面同源的 /ws"（先攻追踪器），
// 也可传入自定义路径（如 /ws/kards）。不需要任何环境变量、也不需要推断端口号。
//
// 因为页面和WebSocket由同一个Node进程、同一个端口提供服务（见 server/index.js），
// 所以浏览器访问什么地址，WebSocket就连什么地址：
//   本地开发   http://localhost:9999        -> ws://localhost:9999/ws
//   局域网     http://192.168.1.50:9999     -> ws://192.168.1.50:9999/ws
//   公网域名   https://box.dsqqlb.top       -> wss://box.dsqqlb.top/ws
// window.location.host 自带端口（有端口时），https自动切wss，所以三种场景都不用额外配置。
export function getWsUrl(path = '/ws'): string {
  // SSR/静态导出预渲染阶段没有window，返回占位值；真正连接发生在客户端useEffect里
  if (typeof window === 'undefined') return '';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
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
          console.error('   1. 服务未通过 server/index.js 启动（开发用 npm run dev，生产用 npm start）');
          console.error('   2. 反向代理/隧道没有转发WebSocket升级请求（当前尝试: ' + url + '）');
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
