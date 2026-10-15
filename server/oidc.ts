import * as client from 'openid-client'
import type { AuthProvider } from './authProvider.js'
import type { OidcSettings } from './config.js'

export function createOidcProvider(settings: OidcSettings): AuthProvider {
  let discovered: Promise<client.Configuration> | undefined

  // Discovery is lazy so a temporarily unreachable IdP does not stop the server from starting.
  const getConfiguration = () => {
    discovered ??= client.discovery(new URL(settings.issuerUrl), settings.clientId, settings.clientSecret).catch((error) => {
      discovered = undefined
      throw error
    })
    return discovered
  }

  return {
    async beginLogin() {
      const configuration = await getConfiguration()
      const transaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      }
      const url = client.buildAuthorizationUrl(configuration, {
        redirect_uri: settings.redirectUri,
        scope: 'openid email profile',
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
        code_challenge_method: 'S256',
      })
      return { url: url.toString(), transaction }
    },

    async completeLogin(callbackUrl, transaction) {
      const configuration = await getConfiguration()
      const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      if (!claims || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
        throw new Error('The identity provider did not return a subject and email.')
      }
      return {
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : undefined,
      }
    },
  }
}
