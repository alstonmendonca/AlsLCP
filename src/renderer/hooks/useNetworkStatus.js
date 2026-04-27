import { useEffect, useRef, useState } from 'react';
import ipcService from '@/services/ipcService';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const handleOnline = () => {
      if (mountedRef.current) setIsOnline(true);
    };
    const handleOffline = () => {
      if (mountedRef.current) setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const checkConnectivity = async () => {
    setChecking(true);
    try {
      const online = await ipcService.invoke('check-network');
      if (mountedRef.current) setIsOnline(online);
      return online;
    } catch (_) {
      if (mountedRef.current) setIsOnline(false);
      return false;
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  return { isOnline, checking, checkConnectivity };
}

export default useNetworkStatus;
