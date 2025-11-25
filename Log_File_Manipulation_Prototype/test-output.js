#!/usr/bin/env node
// Test script to verify output works

// Force unbuffered output
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

console.log('=== TEST OUTPUT SCRIPT ===');
console.log('If you see this, console.log works!');
process.stdout.write('If you see this, process.stdout.write works!\n');
process.stderr.write('If you see this, process.stderr.write works!\n');

console.log('Loading express...');
const express = require('express');
console.log('Express loaded!');

console.log('Loading config...');
const config = require('./config');
console.log('Config loaded!');

console.log('Loading googleapis (this might take a moment)...');
const { google } = require('googleapis');
console.log('Googleapis loaded!');

console.log('=== ALL MODULES LOADED ===');
console.log('If you see this message, everything is working!');

