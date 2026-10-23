/**
 * Convert a string to a URL-friendly slug
 * @param {string} text - The text to slugify
 * @returns {string} - The slugified text
 *
 * @example
 * slugify("Crowd detect") // "crowd-detect"
 * slugify("Video Fire Detection") // "video-fire-detection"
 */
export const slugify = text => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return (
    text
      .toString()
      .toLowerCase()
      .trim()
      // Replace spaces and underscores with hyphens
      .replace(/\s+/g, '-')
      .replace(/_/g, '-')
      // Remove special characters except hyphens
      .replace(/[^\w\-]+/g, '')
      // Replace multiple hyphens with single hyphen
      .replace(/\-\-+/g, '-')
      // Remove leading and trailing hyphens
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
};

/**
 * Create a unique slug by appending eventId if needed
 * @param {string} text - The text to slugify
 * @param {number|string} eventId - The event ID to append if needed
 * @param {Array} existingSlugs - Array of existing slugs to check against
 * @returns {string} - The unique slugified text
 */
export const createUniqueSlug = (text, eventId, existingSlugs = []) => {
  let slug = slugify(text);

  // If slug is empty, use eventId
  if (!slug) {
    return `event-${eventId}`;
  }

  // Check if slug already exists
  if (existingSlugs.includes(slug)) {
    // Append eventId to make it unique
    slug = `${slug}-${eventId}`;
  }

  return slug;
};
