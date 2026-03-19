import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithPopup,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const actionCodeSettings = {
    url: window.location.origin,
    handleCodeInApp: false,
  };

  function signup(email, password) {
    return createUserWithEmailAndPassword(auth, email, password).then((cred) => {
      return sendEmailVerification(cred.user, actionCodeSettings).then(() => cred);
    });
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  function googleSignIn() {
    return signInWithPopup(auth, googleProvider);
  }

  function resendVerification() {
    if (currentUser && !currentUser.emailVerified) {
      return sendEmailVerification(currentUser, actionCodeSettings);
    }
    return Promise.resolve();
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email, actionCodeSettings);
  }

  function reloadUser() {
    if (currentUser) {
      return currentUser.reload().then(() => {
        setCurrentUser({ ...auth.currentUser });
      });
    }
    return Promise.resolve();
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    signup,
    login,
    logout,
    googleSignIn,
    resendVerification,
    reloadUser,
    resetPassword,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
