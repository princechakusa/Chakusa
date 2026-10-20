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

const GALLERY_WIDTH = 1600;
const GALLERY_MAX_BYTES = 690_000; // under the API's 700 KB per-photo cap

/**
 * Picks a gallery photo for the business page: no crop, longest side capped
 * at 1600 px, JPEG. Returns raw base64 (no data: prefix), or null if cancelled.
 */
export async function pickGalleryImage(): Promise<string | null> {
  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
  } catch {
    throw new ProfileImageError('Could not open your photos. Check that Chakusa is allowed to access them.');
  }
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  try {
    const landscape = (asset.width ?? 0) >= (asset.height ?? 0);
    const resize = landscape ? { width: Math.min(GALLERY_WIDTH, asset.width || GALLERY_WIDTH) } : { height: Math.min(GALLERY_WIDTH, asset.height || GALLERY_WIDTH) };
    for (const compress of [0.78, 0.62, 0.48]) {
      const result = await ImageManipulator.manipulateAsync(asset.uri, [{ resize }], { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!result.base64) throw new Error('no data');
      if ((result.base64.length * 3) / 4 <= GALLERY_MAX_BYTES) return result.base64;
    }
    throw new ProfileImageError('That photo is still too large after shrinking. Try another one.');
  } catch (caught) {
    if (caught instanceof ProfileImageError) throw caught;
    throw new ProfileImageError('Could not read that photo. Try another one.');
  }
}
