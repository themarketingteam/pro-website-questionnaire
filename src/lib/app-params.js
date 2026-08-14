const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

// Custom-domain builds do not always receive Base44's Vite environment values.
// These identifiers are public client configuration (not secrets) and keep every
// browser entry path pointed at the correct Base44 application.
export const DEFAULT_BASE44_APP_ID = '6925fec3678942d22522b010';
export const DEFAULT_BASE44_BACKEND_URL = 'https://base44.app';

const normalizeParamValue = (value) => {
	if (value === null || value === undefined) return null;
	const normalized = String(value).trim();
	if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
	return normalized;
};

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export const shouldUseFunctionsVersion = (hostname = '') => {
	const normalized = String(hostname || '').trim().toLowerCase();
	return normalized === 'app.base44.com'
		|| normalized === 'base44.app'
		|| normalized.endsWith('.base44.app');
};

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = normalizeParamValue(urlParams.get(paramName));
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	const normalizedDefaultValue = normalizeParamValue(defaultValue);
	if (normalizedDefaultValue) {
		storage.setItem(storageKey, normalizedDefaultValue);
		return normalizedDefaultValue;
	}
	const storedValue = normalizeParamValue(storage.getItem(storageKey));
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	const functionsVersion = (() => {
		if (isNode) return null;
		if (!shouldUseFunctionsVersion(window.location.hostname)) {
			// A version captured while using the Base44 editor must never pin the
			// public custom domain to an older backend-function deployment.
			storage.removeItem('base44_functions_version');
			return null;
		}
		return getAppParamValue('functions_version');
	})();
	return {
		appId: getAppParamValue("app_id", {
			defaultValue: import.meta.env.VITE_BASE44_APP_ID || DEFAULT_BASE44_APP_ID
		}),
		serverUrl: getAppParamValue("server_url", {
			defaultValue: import.meta.env.VITE_BASE44_BACKEND_URL || DEFAULT_BASE44_BACKEND_URL
		}),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion,
	}
}


export const appParams = {
	...getAppParams()
}
