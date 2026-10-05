import { useEffect, useState } from 'react';
import { getMessageUsers } from '../models/storage';

export function useUserProfilePhotos(enabled = true): Record<string, string> {
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let active = true;
    void getMessageUsers()
      .then(users => {
        if (!active) {
          return;
        }

        const nextProfilePhotos: Record<string, string> = {};
        users.forEach(account => {
          if (account.id && account.profilePhoto?.trim()) {
            nextProfilePhotos[account.id] = account.profilePhoto.trim();
          }
        });
        setProfilePhotos(nextProfilePhotos);
      })
      .catch(() => {
        // Initials remain visible when the messaging photo directory is unavailable.
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return profilePhotos;
}
