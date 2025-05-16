/**
* Password processing tool
*
* The front-end does not perform actual encryption/decryption operations, but determines the processing method by identifying the tags sent from the back-end.
*/

/**
* Check whether the password needs to be re-entered
* @param host host information
* @returns Return true if the password is encrypted and not modified, otherwise return false
*/
export const isPasswordEncrypted = (host: any): boolean => {
  return host && host.is_password_encrypted === true;
};

/**
* Prepare host data for API submission
* @param hostData host form data
* @param originalHost OriginalHost (valued when editing)
* @returns Processed host data
*/
export const prepareHostData = (hostData: any, originalHost?: any): any => {
// Copy host data
const preparedData = { ...hostData };

// If it is edit mode and the password is a placeholder, it means that the password has not been modified.
if (originalHost && preparedData.password === '*********' && isPasswordEncrypted(originalHost)) {
// If the password field is not passed, the backend will retain the original password
delete preparedData.password;
}
  
  return preparedData;
};

/**
* Get the password display value
* For encrypted passwords, placeholders are displayed, otherwise the original value is displayed.
* @param host host information
* @returns The password value used to display
*/
export const getPasswordDisplayValue = (host: any): string => {
  if (!host) return '';
  
  // If the password is encrypted, placeholder is displayed
  if (isPasswordEncrypted(host)) {
    return '********';
  }
// Otherwise, the original password will be displayed
  return host.password || '';
};

export default {
  isPasswordEncrypted,
  prepareHostData,
  getPasswordDisplayValue,
}; 