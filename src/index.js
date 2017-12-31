var plist = require('plist');
var fs   = require('fs');
var shell = require('shelljs');
var program = require('commander');
var legally = require('legally/lib/legally');
var licensing = require('tldrlegal/lib/licensing');
var obligationInfo = require('tldrlegal/metadata/obligationInfo');
var licenseObligations = require('tldrlegal/metadata/licenseObligations');
var xcode = require('xcode');

var ACKNOWLEDGEMENT_PLIST_TEMPLATE = { PreferenceSpecifiers: [], StringsTable: 'Acknowledgements' };
var ACKNOWLEDGEMENT_TEMPLATE = { Type: 'PSGroupSpecifier', FooterText: '', Title: '' };

var IOS_PROJECT = 'ios/*.xcodeproj/project.pbxproj';

function setup() {
  shell.mkdir('-p', 'ios/Settings.bundle');

  // create ios/Settings.bundle/Root.plist // TODO handle existing
  var rootPlist = plist.build({
    PreferenceSpecifiers: [{ File: Acknowledgements, Title: Acknowledgements, Type: PSChildPaneSpecifier }],
    StringsTable: Root
  });
  fs.writeFileSync('ios/Settings.bundle/Root.plist', rootPlist);

  // add script to run before building
  var project = xcode.project(IOS_PROJECT);

  project.parse(function(err) {
    if (err) {
      console.error(err);
      return;
    }


    var buildScripts = [];
    for (var key in project.hash.project.objects.PBXShellScriptBuildPhase || {}) {
      if (project.hash.project.objects.PBXShellScriptBuildPhase.hasOwnProperty(key)) {
        var val = project.hash.project.objects.PBXShellScriptBuildPhase[key];
        if (Array.isArray(val)) {
          buildScripts.push(val);
        }
      }
    }

    for (const script of buildScripts) {
      if (script.shellScript.match(/generate-acknowledgements\s*/)) {
        // we've already installed
        return;
      }
    }

    project.addBuildPhase(
      [],
      'PBXShellScriptBuildPhase',
      'Regenerate acknowledgements',
      project.getFirstTarget().uuid,
      {
        shellPath: '/bin/sh',
        shellScript:
          '../node_modules/react-native-acknowledgements/bin/generate-acknowledgements',
      }
    );

    // we always modify the xcode file in memory but we only want to save it
    // in case the user wants configuration for ios.  This is why we check
    // here first if changes are made before we might prompt the platform
    // continue prompt.
    var newContents = project.writeSync();
    fs.writeFileSync(projectPath, newContents);
  });
}

function generateSettingsBundle(path, name, acknowledgementTypes) {
  // ios/Settings.bundle/Acknowledgements.plist

  var acknowledgements = Object.assign({}, ACKNOWLEDGEMENT_PLIST_TEMPLATE);
  for (var package in acknowledgementTypes.includeLicense) {
    var acknowledgement = Object.assign({}, ACKNOWLEDGEMENT_TEMPLATE);
    acknowledgement.Title = package.name;
    acknowledgement.FooterText = package.license; // TODO may need to rewalk node_mdules to include original license
    acknowledgements.PreferenceSpecifiers.push(acknowledgement);
  }

  var acknowledgementsPlist = plist.build(acknowledgements);
  fs.writeFileSync('ios/Settings.bundle/Acknowledgements.plist', acknowledgementsPlist);
}

// Note includeOriginal, discloseSource, stateChanges are outside the scope of this project
var RELEVANT_OBLIGATIONS = ['giveCredit', 'includeLicense', 'includeCopyright', 'includeNotice'];
var CLOSED_SOURCE = true;

function calculateAcknowledgements(directory) {
  // Fetch dependencies and their licenses by directory
  var packages = legally(directory);

  // Result variables
  var results = {}, unknownLicenses = [];

  // Traverse all dependencies
  for (var packageName in packages) {
    // Get SPDX license code
    var license = licensing.getPreferredPackageLicense(packages[packageName], CLOSED_SOURCE);

    // Get obligations for this license
    var obligations = licenseObligations[license];

    // No obligations documented for this license?
    if (!obligations) {
      // Add to list of unknown licenses
      unknownLicenses.push([packageName, license]);

      // Nothing else to do here
      continue;
    }

    // Traverse obligations for this license
    for (var obligation in obligations) {
      if (!RELEVANT_OBLIGATIONS.indexOf(obligation)) {
        continue;
      }

      // Prepare an array of packages for this obligation
      if (!results[obligation]) {
          results[obligation] = [];
      }

      // Add current package and its license under this obligation
      results[obligation].push({name: packageName, license: license});
    }
  }

  return { obligations, unknownLicenses };
}


module.exports = { generateSettingsBundle, calculateAcknowledgements, setup };


// should_include_settings = user_options["settings_bundle"] != nil
// excluded_pods = Set.new(user_options["exclude"])
// sandbox = context.sandbox if defined? context.sandbox
// sandbox ||= Pod::Sandbox.new(context.sandbox_root)
// context.umbrella_targets.each do |umbrella_target|
//   project = Xcodeproj::Project.open(umbrella_target.user_project_path)
//   umbrella_target.user_target_uuids.each do |user_target_uuid|
//     # Generate a plist representing all of the podspecs
//     metadata = PlistGenerator.generate(umbrella_target, sandbox, excluded_pods)
//     next unless metadata
//     plist_path = sandbox.root + "#{umbrella_target.cocoapods_target_label}-metadata.plist"
//     save_metadata(metadata, plist_path, project, sandbox, user_target_uuid)
//     if should_include_settings
//       # Generate a plist in Settings format
//       settings_metadata = SettingsPlistGenerator.generate(umbrella_target, sandbox, excluded_pods)
//       # We need to look for a Settings.bundle
//       # and add this to the root of the bundle
//       settings_bundle = settings_bundle_in_project(project)
//       if settings_bundle == nil
//         Pod::UI.warn "Could not find a Settings.bundle to add the Pod Settings Plist to."
//       else
//         settings_plist_path = settings_bundle + "/#{umbrella_target.cocoapods_target_label}-settings-metadata.plist"
//         save_metadata(settings_metadata, settings_plist_path, project, sandbox, user_target_uuid)
//         Pod::UI.info "Added Pod info to Settings.bundle for target #{umbrella_target.cocoapods_target_label}"
//         # Support a callback for the key :settings_post_process
//         if user_options["settings_post_process"]
//           user_options["settings_post_process"].call(settings_plist_path, umbrella_target, excluded_pods)
//         end
//       end
//     end
// end
