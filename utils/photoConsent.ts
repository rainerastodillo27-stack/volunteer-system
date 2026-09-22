import { Alert } from 'react-native';

export const CHILD_PROTECTION_PRIVACY_NOTICE =
  'Photos and videos submitted through NVC Connect are used only for registration, attendance verification, project documentation, and authorized reporting. Do not upload inappropriate, exploitative, or unnecessary images of children. If a child appears in submitted media, the uploader must ensure that the image was obtained and submitted with appropriate authorization or consent.';

export const PHOTO_CONSENT_CONFIRMATION =
  'I confirm that this photo complies with the Child Protection and Privacy Notice and that I have the appropriate authorization or consent for any child shown.';

export function requestPhotoPrivacyConsent(): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(accepted);
    };

    Alert.alert(
      'Child Protection and Privacy Notice',
      `${CHILD_PROTECTION_PRIVACY_NOTICE}\n\n${PHOTO_CONSENT_CONFIRMATION}`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
        { text: 'I Agree', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}
