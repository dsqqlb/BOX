import { useEffect, useRef, useCallback, useState } from 'react';

interface WebSocketMessage {
  type: string;
  payload: any;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
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
