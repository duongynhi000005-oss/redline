# Adds a large team to the dev Redmine for checking Redline's speed with
# thousands of issues. Run seed.rb first (it creates the users and fields).
#
#   dev/redmine/seed-large.sh            # 5,000 issues
#   LARGE_ISSUES=20000 dev/redmine/seed-large.sh
#
# Idempotent: tops the "Load" team up to LARGE_ISSUES issues and leaves
# everything else alone. Never run this against a real Redmine.

ActionMailer::Base.perform_deliveries = false
Rails.logger.level = :warn
ActiveJob::Base.logger.level = :warn if defined?(ActiveJob)

def say(msg) = puts("seed-large: #{msg}")

target = Integer(ENV.fetch("LARGE_ISSUES", "5000"))
user = User.find_by!(login: "dev")
teammate = User.find_by!(login: "sam")
developer = Role.find_by(name: "Developer") || Role.givable.first
labels = IssueCustomField.find_by!(name: "Area")
size = IssueCustomField.find_by!(name: "Size")

load = Project.find_by(identifier: "load") || Project.new.tap do |p|
  p.identifier = "load"
  p.name = "Load"
  p.is_public = false
  p.enabled_module_names = %w[issue_tracking time_tracking]
  p.trackers = Tracker.all
  p.save!
  say "created team Load"
end
[user, teammate].each do |member|
  Member.create!(project: load, principal: member, roles: [developer]) unless Member.exists?(project: load, user: member)
end

today = Date.today
versions = (1..12).map do |n|
  load.versions.find_by(name: "Load sprint #{n}") ||
    load.versions.create!(name: "Load sprint #{n}", effective_date: today + (n - 6) * 14,
                          status: "open", sharing: "none")
end
categories = %w[Frontend Backend Infra Docs].map { |name| load.issue_categories.find_or_create_by!(name: name) }

statuses = IssueStatus.sorted.to_a
priorities = IssuePriority.active.to_a
trackers = Tracker.sorted.to_a
verbs = %w[Fix Add Improve Remove Rename Speed\ up Document Refactor Test Polish]
nouns = ["the sign-in form", "sync on wake", "board columns", "the timeline zoom", "keyboard focus",
         "markdown tables", "the inbox", "custom field labels", "cycle progress", "file uploads",
         "the command menu", "dark mode", "attachments", "time entries", "wiki links"]

have = load.issues.count
# Issues can only go into open versions; the past ones close again below.
versions.each { |v| v.update!(status: "open") unless v.status == "open" } if have < target
User.current = user
created = 0
(have...target).each_slice(500) do |slice|
  Issue.transaction do
    slice.each do |i|
      issue = Issue.new(
        project: load, tracker: trackers[i % trackers.size], author: [user, teammate][i % 2],
        subject: "#{verbs[i % verbs.size]} #{nouns[(i / verbs.size) % nouns.size]} (#{i + 1})",
        description: "Load test issue #{i + 1}.\n\n- [ ] One\n- [ ] Two\n\nSee ##{[i, 1].max} for context.",
        status: statuses[i % statuses.size],
        priority: priorities[i % priorities.size],
        assigned_to: [user, teammate, nil][i % 3],
        fixed_version: (i % 5).zero? ? nil : versions[i % versions.size],
        category: (i % 4).zero? ? nil : categories[i % categories.size],
        start_date: (i % 3).zero? ? nil : today + ((i % 60) - 30),
        estimated_hours: (i % 7).zero? ? nil : (i % 8) + 1
      )
      issue.due_date = issue.start_date + (i % 10) if issue.start_date
      issue.custom_field_values = {
        labels.id.to_s => [%w[UI], %w[Sync], %w[UI Performance], %w[API], %w[Docs]][i % 5],
        size.id.to_s => %w[S M L XL][i % 4],
      }
      issue.save!
      created += 1
    end
  end
  say "#{have + created} of #{target} issues"
end

# Some structure: sub-issues and relations, so the related sections and the
# timeline's arrows have work to do at scale.
if created.positive?
  ids = load.issues.order(:id).pluck(:id)
  ids.each_slice(50) do |group|
    parent = Issue.find(group.first)
    group[1, 3].to_a.each do |child_id|
      child = Issue.find(child_id)
      next if child.parent_id
      child.parent_issue_id = parent.id
      child.save!
    end
  end
  ids.each_slice(2).first(ids.size / 20).each do |a, b|
    next unless b
    IssueRelation.create(issue_from_id: a, issue_to_id: b, relation_type: "relates")
  end
  say "added sub-issues and relations"
end

# Past sprints are closed, as on a real team (only after issues are in them:
# Redmine refuses new issues in a closed version).
versions.first(4).each { |v| v.update!(status: "closed") unless v.status == "closed" }

say "Load has #{load.issues.count} issues"
