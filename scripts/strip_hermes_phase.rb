#!/usr/bin/env ruby
require 'xcodeproj'

# Match both the explicit "Replace Hermes" phase and any stray phases tagged
# with bracketed [Hermes] names.
MARKERS = ['replace hermes', '[hermes]'].freeze

def scrub_project(path)
  project = Xcodeproj::Project.open(path)
  changed = false
  project.targets.each do |t|
    t.build_phases.select do |p|
      p.isa == 'PBXShellScriptBuildPhase' &&
        MARKERS.any? { |m| ((p.name || '') + (p.shell_script || '')).downcase.include?(m) }
    end.each do |p|
      t.build_phases.delete(p)
      p.remove_from_project
      changed = true
    end
  end
  project.save if changed
  puts "[strip_hermes_phase] #{File.basename(path)}: #{changed ? 'removed phases' : 'nothing to remove'}"
end

paths = ARGV.flat_map do |proj|
  if File.directory?(proj)
    Dir.glob(File.join(proj, '**/*.xcodeproj'))
  else
    proj
  end
end

paths.each do |proj|
  if File.exist?(proj)
    scrub_project(proj)
  else
    warn "[strip_hermes_phase] not found: #{proj}"
  end
end



