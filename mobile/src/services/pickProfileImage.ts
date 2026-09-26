import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Picks a photo for a profile picture or business photo: the system photo
// library (no camera or microphone permission), a square crop, then shrunk
// to 512 px JPEG so any phone photo fits the server's image limit (a typical
// result is 30-80 KB). Returns a data URI ready to save, or null if cancelled.

export class ProfileImageError extends Error {}

const SIZE = 512;
const MAX_DATA_URL = 380_000; // under the API's 400 KB cap

export async function pickProfileImage(): Promise<string | null> {
  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  } catch {
    throw new ProfileImageError('Could not open your photos. Check that Chakusa is allowed to access them.');
  }
  if (picked.canceled || !picked.assets[0]) return null;
  try {
    const result = await ImageManipulator.manipulateAsync(
      picked.assets[0].uri,
      [{ resize: { width: SIZE, height: SIZE } }],
      { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) throw new Error('no data');
    const dataUrl = `data:image/jpeg;base64,${result.base64}`;
    if (dataUrl.length > MAX_DATA_URL) throw new ProfileImageError('That photo is still too large after shrinking. Try another one.');
    return dataUrl;
  } catch (caught) {
    if (caught instanceof ProfileImageError) throw caught;
    throw new ProfileImageError('Could not read that photo. Try another one.');
  }
}
